// Read-aloud that survives browser autoplay rules (Chrome, iPad Safari).

let current: SpeechSynthesisUtterance | null = null; // keep a reference so Chrome doesn't drop it

function supported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// Call inside a tap. Speaking once from a real tap unlocks speech for the rest of the page.
export function unlockSpeech() {
  if (!supported()) return;
  try {
    const u = new SpeechSynthesisUtterance(".");
    u.volume = 0;
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(u);
  } catch {
    // ignore
  }
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const base = lang.slice(0, 2).toLowerCase();
  return (
    voices.find((v) => v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase()) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(base)) ||
    null
  );
}

export function speakText(text: string, lang: string, onState?: (s: "speaking" | "done" | "error") => void) {
  if (!supported() || !text.trim()) {
    onState?.("error");
    return;
  }
  const synth = window.speechSynthesis;
  const go = () => {
    const u = new SpeechSynthesisUtterance(text);
    let started = false;
    u.lang = lang;
    const v = pickVoice(lang);
    if (v) u.voice = v;
    u.rate = 0.95;
    u.onstart = () => {
      started = true;
      onState?.("speaking");
    };
    u.onend = () => onState?.("done");
    u.onerror = (e) => {
      if (e.error !== "interrupted" && e.error !== "canceled") onState?.("error");
    };
    current = u;
    synth.resume();
    synth.speak(u);
    // If the browser blocked it, nothing starts: report that so the UI can offer the Listen button.
    setTimeout(() => {
      if (current === u && !started && !synth.speaking && !synth.pending) onState?.("error");
    }, 1500);
  };
  // Speaking right after cancel() is silently dropped in Chrome, so wait a moment.
  if (synth.speaking || synth.pending) {
    synth.cancel();
    setTimeout(go, 150);
  } else {
    go();
  }
}

export function stopSpeech() {
  if (supported()) window.speechSynthesis.cancel();
}
