import { useEffect, useRef, useState } from "react"

let ytApiPromise = null

/** Завантажує офіційний YouTube IFrame Player API один раз на весь застосунок. */
function loadYouTubeAPI() {
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT)
      return
    }
    const tag = document.createElement("script")
    tag.src = "https://www.youtube.com/iframe_api"
    document.body.appendChild(tag)
    window.onYouTubeIframeAPIReady = () => resolve(window.YT)
  })
  return ytApiPromise
}

const FADE_STEP_MS = 200

/**
 * Два YouTube-плеєри, що чергуються (A/B). За `crossfadeSeconds` до кінця
 * активного треку підвантажується наступний (queue[1]) у другий плеєр і грає
 * паралельно з наростанням гучності, поки активний плавно затихає.
 *
 * `queue` — відтворювані videoId, починаючи з поточного (queue[0] = зараз грає).
 * `onAdvance` викликається щоразу, коли треба перейти до наступного треку
 * (і після завершеного кросфейду, і коли останній трек у черзі просто
 * закінчився природно, без кросфейду).
 */
export default function Player({ queue, onAdvance, crossfadeSeconds = 20 }) {
  const containerRefs = [useRef(null), useRef(null)]
  const playersRef = useRef([null, null])
  const readyRef = useRef([false, false])
  const activeSlotRef = useRef(0)
  const crossfadingRef = useRef(false)
  const crossfadedRef = useRef(false) // щойно завершили кросфейд -> onAdvance не мав перезавантажувати
  const isFirstQueueEffect = useRef(true)
  const queueRef = useRef(queue)
  const pollIntervalRef = useRef(null)
  const fadeIntervalRef = useRef(null)
  const [volumes, setVolumes] = useState([100, 100]) // гучність-"стеля" для кожного фізичного плеєра (0/1)
  const volumesRef = useRef(volumes)

  useEffect(() => {
    queueRef.current = queue
  })

  useEffect(() => {
    volumesRef.current = volumes
  }, [volumes])

  function setSlotVolume(slot, value) {
    setVolumes((prev) => {
      const next = [...prev]
      next[slot] = value
      return next
    })
    playersRef.current[slot]?.setVolume?.(value)
  }

  function advance() {
    onAdvance?.()
  }

  useEffect(() => {
    let cancelled = false
    loadYouTubeAPI().then((YT) => {
      if (cancelled) return
      containerRefs.forEach((ref, slot) => {
        const initialVideoId = slot === 0 ? queueRef.current[0] : undefined
        playersRef.current[slot] = new YT.Player(ref.current, {
          height: "500",
          width: "500",
          ...(initialVideoId ? { videoId: initialVideoId } : {}),
          playerVars: { autoplay: 1 },
          events: {
            onReady: () => {
              readyRef.current[slot] = true
              playersRef.current[slot]?.setVolume?.(volumesRef.current[slot])
            },
            onStateChange: (e) => {
              if (
                slot === activeSlotRef.current &&
                !crossfadingRef.current &&
                e.data === YT.PlayerState.ENDED
              ) {
                advance()
              }
            },
          },
        })
      })
    })
    return () => {
      cancelled = true
      clearInterval(pollIntervalRef.current)
      clearInterval(fadeIntervalRef.current)
      playersRef.current.forEach((p) => p?.destroy?.())
      playersRef.current = [null, null]
    }
    // Плеєри створюються один раз; далі керуємо через queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Поллінг активного плеєра — запускає кросфейд за crossfadeSeconds до кінця.
  useEffect(() => {
    pollIntervalRef.current = setInterval(() => {
      if (crossfadingRef.current) return
      const activeSlot = activeSlotRef.current
      const active = playersRef.current[activeSlot]
      if (!active || !readyRef.current[activeSlot] || !active.getDuration) return
      const duration = active.getDuration()
      const current = active.getCurrentTime?.() || 0
      const nextId = queueRef.current[1]
      if (nextId && duration > 0 && duration - current <= crossfadeSeconds) {
        startCrossfade(nextId)
      }
    }, 500)
    return () => clearInterval(pollIntervalRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossfadeSeconds])

  function startCrossfade(nextVideoId) {
    const activeSlot = activeSlotRef.current
    const nextSlot = activeSlot === 0 ? 1 : 0
    const activePlayer = playersRef.current[activeSlot]
    const nextPlayer = playersRef.current[nextSlot]
    if (!nextPlayer || !readyRef.current[nextSlot]) return

    crossfadingRef.current = true
    nextPlayer.setVolume?.(0)
    nextPlayer.loadVideoById(nextVideoId)

    const steps = Math.max(1, Math.round((crossfadeSeconds * 1000) / FADE_STEP_MS))
    let i = 0
    fadeIntervalRef.current = setInterval(() => {
      i++
      const t = Math.min(1, i / steps)
      const activeMax = volumesRef.current[activeSlot]
      const nextMax = volumesRef.current[nextSlot]
      activePlayer.setVolume?.(Math.round(activeMax * (1 - t)))
      nextPlayer.setVolume?.(Math.round(nextMax * t))
      if (t >= 1) {
        clearInterval(fadeIntervalRef.current)
        activePlayer.pauseVideo?.()
        activeSlotRef.current = nextSlot
        crossfadingRef.current = false
        crossfadedRef.current = true
        advance()
      }
    }, FADE_STEP_MS)
  }

  // Реакція на зміну "поточного" треку ззовні: клік по черзі, ⏮/⏭, перемішування,
  // або природний кінець останнього треку в черзі (без кросфейду).
  useEffect(() => {
    const nextExpected = queue[0]
    if (!nextExpected) return
    if (isFirstQueueEffect.current) {
      isFirstQueueEffect.current = false
      return
    }
    if (crossfadedRef.current) {
      // Вже граємо цей трек через щойно завершений кросфейд — нічого робити не треба.
      crossfadedRef.current = false
      return
    }

    clearInterval(fadeIntervalRef.current)
    crossfadingRef.current = false

    const activeSlot = activeSlotRef.current
    const otherSlot = activeSlot === 0 ? 1 : 0
    playersRef.current[otherSlot]?.pauseVideo?.()
    playersRef.current[otherSlot]?.setVolume?.(volumesRef.current[otherSlot])

    const active = playersRef.current[activeSlot]
    if (active?.loadVideoById && readyRef.current[activeSlot]) {
      active.setVolume?.(volumesRef.current[activeSlot])
      active.loadVideoById(nextExpected)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue[0]])

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      {containerRefs.map((ref, slot) => (
        <div key={slot} style={{ width: 500 }}>
          <div ref={ref} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <span>🔊</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={volumes[slot]}
              onChange={(e) => setSlotVolume(slot, Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ width: 32, textAlign: "right" }}>{volumes[slot]}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
