// Records the live movie in the browser.
//
// Recording the WebRTC stream directly is fragile: when the model adds or swaps a track
// mid-session (audio usually arrives after video), MediaRecorder stops with an error and the
// take is lost. Instead we draw the <video> onto our own canvas and mix audio through Web
// Audio, giving MediaRecorder one stable video track and one stable audio track for the
// whole session.

export type Recording = { url: string; size: number; type: string; extension: string };

const MAX_WIDTH = 1280;
const FPS = 24;

function pickMimeType(): { type: string; extension: string } {
  const candidates = [
    { type: "video/mp4;codecs=avc1,mp4a.40.2", extension: "mp4" },
    { type: "video/mp4", extension: "mp4" },
    { type: "video/webm;codecs=vp9,opus", extension: "webm" },
    { type: "video/webm", extension: "webm" },
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c.type)) ?? { type: "", extension: "webm" };
}

export class MovieRecorder {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private audio = new AudioContext();
  private destination = this.audio.createMediaStreamDestination();
  private connected = new Set<string>();
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private frame = 0;
  private format = pickMimeType();

  constructor(private video: HTMLVideoElement, private stream: MediaStream) {
    this.stream.addEventListener("addtrack", () => this.connectAudio());
  }

  static supported() {
    return typeof MediaRecorder !== "undefined" && typeof AudioContext !== "undefined" &&
      typeof HTMLCanvasElement.prototype.captureStream === "function";
  }

  start() {
    this.audio.resume().catch(() => {});
    this.connectAudio();
    const draw = () => {
      const { videoWidth: w, videoHeight: h } = this.video;
      if (w && h) {
        if (!this.canvas.width) {
          const scale = Math.min(1, MAX_WIDTH / w);
          this.canvas.width = Math.round((w * scale) / 2) * 2;
          this.canvas.height = Math.round((h * scale) / 2) * 2;
        }
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
        if (!this.recorder) this.begin();
      }
      this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
  }

  private connectAudio() {
    for (const track of this.stream.getAudioTracks()) {
      if (this.connected.has(track.id)) continue;
      this.connected.add(track.id);
      this.audio.createMediaStreamSource(new MediaStream([track])).connect(this.destination);
    }
  }

  // Starts recording once the first frame is drawn, so the file never opens on a black frame.
  private begin() {
    const tracks = [...this.canvas.captureStream(FPS).getVideoTracks(), ...this.destination.stream.getAudioTracks()];
    const options: MediaRecorderOptions = { videoBitsPerSecond: 5_000_000 };
    if (this.format.type) options.mimeType = this.format.type;
    this.recorder = new MediaRecorder(new MediaStream(tracks), options);
    this.recorder.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
    this.recorder.start(1000);
  }

  /** Stops recording and resolves with the finished file, or null if nothing was captured. */
  stop(): Promise<Recording | null> {
    cancelAnimationFrame(this.frame);
    const recorder = this.recorder;
    const finish = () => {
      this.audio.close().catch(() => {});
      if (!this.chunks.length) return null;
      const type = recorder?.mimeType || this.format.type || "video/webm";
      const blob = new Blob(this.chunks, { type });
      return { url: URL.createObjectURL(blob), size: blob.size, type, extension: type.includes("mp4") ? "mp4" : "webm" };
    };
    if (!recorder || recorder.state === "inactive") return Promise.resolve(finish());
    return new Promise((resolve) => {
      recorder.onstop = () => resolve(finish());
      recorder.stop();
    });
  }
}
