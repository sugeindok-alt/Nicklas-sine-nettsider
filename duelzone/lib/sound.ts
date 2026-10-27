let context: AudioContext | undefined;
let enabled = true;
export function setSound(value: boolean) {
  enabled = value;
  try {
    localStorage.setItem("dz-sound", String(value));
  } catch {}
}
export function soundEnabled() {
  try {
    enabled = localStorage.getItem("dz-sound") !== "false";
  } catch {}
  return enabled;
}
export function unlockSound() {
  if (!enabled) return;
  try {
    context ||= new AudioContext();
    if (context.state === "suspended") void context.resume();
  } catch {}
}
export function tone(kind: "hit" | "miss" | "win" | "loss" | "stage") {
  if (!enabled || !context || context.state !== "running") return;
  const notes = {
    hit: [520, 780],
    miss: [170],
    win: [440, 550, 660, 880],
    loss: [330, 260],
    stage: [360, 540],
  }[kind];
  notes.forEach((frequency, index) => {
    const oscillator = context!.createOscillator(),
      volume = context!.createGain(),
      start = context!.currentTime + index * 0.09;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    volume.gain.setValueAtTime(0, start);
    volume.gain.linearRampToValueAtTime(0.055, start + 0.008);
    volume.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
    oscillator.connect(volume);
    volume.connect(context!.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.18);
  });
}
