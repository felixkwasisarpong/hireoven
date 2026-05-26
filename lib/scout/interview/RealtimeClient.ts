/**
 * RealtimeClient — WebRTC wrapper for OpenAI's Realtime API.
 *
 * Manages a single peer connection to api.openai.com/v1/realtime/calls.
 * Emits typed CustomEvents so UI components can subscribe reactively.
 */

export type RealtimeEventMap = {
  "agent.speaking.start": CustomEvent
  "agent.speaking.end": CustomEvent
  "agent.transcript.delta": CustomEvent<{ text: string }>
  "agent.transcript.completed": CustomEvent<{ text: string; startMs: number; endMs: number }>
  "user.transcript.completed": CustomEvent<{ text: string; startMs: number; endMs: number }>
  "agent.audio.stream": CustomEvent<{ stream: MediaStream }>
  "connection.ready": CustomEvent
  "connection.error": CustomEvent<{ error: string }>
  "connection.closed": CustomEvent
}

export type TranscriptEvent = {
  role: "interviewer" | "candidate"
  content: string
  startMs: number
  endMs: number
}

export type VoiceTimings = {
  totalDurationMs: number
  candidateSpeakingMs: number
  interviewerSpeakingMs: number
  silenceMs: number
}

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls"
const DISCONNECTED_GRACE_MS = 8_000

export class RealtimeClient extends EventTarget {
  private ephemeralToken: string

  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  private agentAudioEl: HTMLAudioElement | null = null
  private disconnectedTimer: ReturnType<typeof setTimeout> | null = null
  private closedEmitted = false

  // Transcript accumulation
  readonly events: TranscriptEvent[] = []
  private currentAgentText = ""
  private agentSpeakStart = 0
  private agentSpeakingMs = 0
  private candidateSpeakingMs = 0
  private sessionStartMs = 0
  private muted = false

  constructor(opts: { ephemeralToken: string }) {
    super()
    this.ephemeralToken = opts.ephemeralToken
  }

  private emit<K extends keyof RealtimeEventMap>(
    type: K,
    detail?: RealtimeEventMap[K] extends CustomEvent<infer D> ? D : never
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.dispatchEvent(new CustomEvent(type, { detail } as any))
  }

  private clearDisconnectedTimer() {
    if (this.disconnectedTimer) {
      clearTimeout(this.disconnectedTimer)
      this.disconnectedTimer = null
    }
  }

  private emitClosedOnce() {
    if (this.closedEmitted) return
    this.closedEmitted = true
    this.emit("connection.closed")
  }

  private scheduleDisconnectedClose() {
    this.clearDisconnectedTimer()
    this.disconnectedTimer = setTimeout(() => {
      const state = this.pc?.connectionState
      if (state === "connected" || state === "connecting") return
      this.emit("connection.error", { error: "WebRTC connection disconnected" })
      this.emitClosedOnce()
    }, DISCONNECTED_GRACE_MS)
  }

  async connect(localStream: MediaStream): Promise<void> {
    this.sessionStartMs = Date.now()
    this.closedEmitted = false
    this.clearDisconnectedTimer()

    // 1. Create peer connection
    this.pc = new RTCPeerConnection()

    // 2. Add local audio track
    const audioTrack = localStream.getAudioTracks()[0]
    if (audioTrack) {
      this.pc.addTrack(audioTrack, localStream)
    }

    // 3. Create data channel
    this.dc = this.pc.createDataChannel("oai-events")
    this.dc.onmessage = (e) => this.handleDataMessage(e.data)
    this.dc.onopen = () => {
      this.clearDisconnectedTimer()
      this.emit("connection.ready")
    }
    this.dc.onerror = (e) => {
      const msg = (e as RTCErrorEvent).error?.message ?? "Data channel error"
      this.emit("connection.error", { error: msg })
    }
    this.dc.onclose = () => {
      const state = this.pc?.connectionState
      if (state === "disconnected") {
        this.scheduleDisconnectedClose()
        return
      }
      this.emitClosedOnce()
    }

    // 4. Handle incoming agent audio
    this.pc.ontrack = (event) => {
      const [stream] = event.streams
      if (!this.agentAudioEl) {
        this.agentAudioEl = document.createElement("audio")
        this.agentAudioEl.autoplay = true
        this.agentAudioEl.style.display = "none"
        document.body.appendChild(this.agentAudioEl)
      }
      this.agentAudioEl.srcObject = stream
      this.emit("agent.audio.stream", { stream })
    }

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState
      if (state === "connected" || state === "connecting") {
        this.clearDisconnectedTimer()
        return
      }
      if (state === "disconnected") {
        // `disconnected` is often transient on unstable networks; allow a grace
        // window before surfacing an end-of-call error.
        this.scheduleDisconnectedClose()
        return
      }
      if (state === "failed") {
        this.clearDisconnectedTimer()
        this.emit("connection.error", { error: "WebRTC connection failed" })
        this.emitClosedOnce()
        return
      }
      if (state === "closed") {
        this.clearDisconnectedTimer()
        this.emitClosedOnce()
      }
    }

    // 5. Create SDP offer
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)

    // 6. Wait for ICE gathering (or 5s timeout)
    await new Promise<void>((resolve) => {
      if (this.pc?.iceGatheringState === "complete") return resolve()
      const handler = () => {
        if (this.pc?.iceGatheringState === "complete") {
          this.pc.removeEventListener("icegatheringstatechange", handler)
          resolve()
        }
      }
      this.pc!.addEventListener("icegatheringstatechange", handler)
      setTimeout(resolve, 5000)
    })

    // 7. POST SDP offer to OpenAI Realtime Calls endpoint
    const res = await fetch(REALTIME_CALLS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.ephemeralToken}`,
        "Content-Type": "application/sdp",
      },
      body: this.pc.localDescription!.sdp,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`OpenAI Realtime rejected SDP: ${res.status} ${text.slice(0, 200)}`)
    }

    const answerSdp = await res.text()
    await this.pc.setRemoteDescription({ type: "answer", sdp: answerSdp })
  }

  private handleDataMessage(raw: string) {
    let event: Record<string, unknown>
    try {
      event = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }

    const type = event.type as string

    switch (type) {
      case "response.audio_transcript.delta": {
        const delta = (event.delta as string) ?? ""
        this.currentAgentText += delta
        this.emit("agent.transcript.delta", { text: delta })
        break
      }

      case "response.audio_transcript.done": {
        const text = (event.transcript as string) ?? this.currentAgentText
        const endMs = Date.now()
        this.emit("agent.transcript.completed", {
          text,
          startMs: this.agentSpeakStart || endMs - 1000,
          endMs,
        })
        if (text.trim()) {
          this.events.push({
            role: "interviewer",
            content: text.trim(),
            startMs: this.agentSpeakStart || endMs - 1000,
            endMs,
          })
        }
        this.currentAgentText = ""
        break
      }

      case "conversation.item.input_audio_transcription.completed": {
        const text = (event.transcript as string) ?? ""
        const endMs = Date.now()
        if (text.trim()) {
          this.candidateSpeakingMs += 1000 // approximate
          this.emit("user.transcript.completed", {
            text: text.trim(),
            startMs: endMs - 2000,
            endMs,
          })
          this.events.push({
            role: "candidate",
            content: text.trim(),
            startMs: endMs - 2000,
            endMs,
          })
        }
        break
      }

      case "output_audio_buffer.started":
        this.agentSpeakStart = Date.now()
        this.emit("agent.speaking.start")
        break

      case "output_audio_buffer.stopped": {
        const dur = Date.now() - this.agentSpeakStart
        this.agentSpeakingMs += dur
        this.emit("agent.speaking.end")
        break
      }

      case "error": {
        const errMsg = ((event.error as Record<string, unknown>)?.message as string) ?? "Realtime API error"
        console.error("[RealtimeClient] error event:", event)
        this.emit("connection.error", { error: errMsg })
        break
      }
    }
  }

  async sendSystemNote(text: string): Promise<void> {
    if (!this.dc || this.dc.readyState !== "open") return
    // Inject a user message (system-style)
    this.dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `[SYSTEM NOTE] ${text}` }],
      },
    }))
    this.dc.send(JSON.stringify({ type: "response.create" }))
  }

  async sendUserMessage(text: string): Promise<void> {
    if (!this.dc || this.dc.readyState !== "open") return
    this.dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    }))
    this.dc.send(JSON.stringify({ type: "response.create" }))
  }

  setMuted(muted: boolean) {
    this.muted = muted
    if (this.pc) {
      this.pc.getSenders().forEach((sender) => {
        if (sender.track?.kind === "audio") {
          sender.track.enabled = !muted
        }
      })
    }
  }

  getVoiceTimings(): VoiceTimings {
    const totalDurationMs = Date.now() - this.sessionStartMs
    return {
      totalDurationMs,
      candidateSpeakingMs: this.candidateSpeakingMs,
      interviewerSpeakingMs: this.agentSpeakingMs,
      silenceMs: Math.max(0, totalDurationMs - this.candidateSpeakingMs - this.agentSpeakingMs),
    }
  }

  async disconnect(): Promise<void> {
    this.clearDisconnectedTimer()
    try { this.dc?.close() } catch { /* ignore */ }
    try {
      this.pc?.getSenders().forEach((s) => { try { s.track?.stop() } catch { /* ignore */ } })
      this.pc?.close()
    } catch { /* ignore */ }
    try {
      if (this.agentAudioEl) {
        this.agentAudioEl.srcObject = null
        this.agentAudioEl.remove()
        this.agentAudioEl = null
      }
    } catch { /* ignore */ }
    this.dc = null
    this.pc = null
    this.emitClosedOnce()
  }
}
