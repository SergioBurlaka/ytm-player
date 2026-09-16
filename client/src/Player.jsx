import { useEffect, useRef } from "react"

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

/**
 * Відтворює один videoId через офіційний вбудований YouTube-плеєр.
 * Викликає onEnded, коли трек закінчився — так App.jsx перемикає на наступний.
 */
export default function Player({ videoId, onEnded }) {
  const containerRef = useRef(null)
  const playerRef = useRef(null)
  const readyRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    loadYouTubeAPI().then((YT) => {
      if (cancelled) return
      playerRef.current = new YT.Player(containerRef.current, {
        height: "200",
        width: "356",
        videoId: videoId || undefined,
        playerVars: { autoplay: 1 },
        events: {
          onReady: () => {
            readyRef.current = true
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) {
              onEnded?.()
            }
          },
        },
      })
    })
    return () => {
      cancelled = true
      playerRef.current?.destroy?.()
      playerRef.current = null
      readyRef.current = false
    }
    // Плеєр створюється один раз; зміна треку далі йде через loadVideoById.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const p = playerRef.current
    if (p && readyRef.current && videoId && p.loadVideoById) {
      p.loadVideoById(videoId)
    }
  }, [videoId])

  return <div ref={containerRef} />
}
