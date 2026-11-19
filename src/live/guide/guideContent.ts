/** The live guide's words. Plain language, English first. Kept as data so it can be searched and edited without touching the screens. */

export interface GuideSection { id: string; title: string; paragraphs: string[]; steps?: string[] }
export interface Problem { id: string; symptom: string; /** Words a person might type that are not in the symptom */ also: string[]; steps: string[] }

export const SECTIONS: ReadonlyArray<GuideSection> = [
  { id: 'how', title: 'How live works in 3 minutes', paragraphs: [
    'A live event is a private room. You create an event, share its link, and open the room when it is time. Guests click the link and wait until you let them in.',
    'Conversation is for a chat with up to three guests: everyone hears everyone. Broadcast is for a show: guests hear only you and the other guests through a mix made on your computer, never their own voice, and you send the finished mix out as Program. If your computer is too slow for Broadcast, Uuda switches the session to a Conversation.',
    'Everyone is recorded on their own device at full quality while the call runs, so the call being rough does not make the recording rough.',
    'Limits on the free plan: 4 people in a room including you, 3 hours per session, 5 live sessions per week.',
  ] },
  { id: 'before', title: 'Before the event', paragraphs: ['Do this a day ahead if you can.'], steps: [
    'Open Live settings (the gear) and run the setup assistant for your equipment.',
    'Run the three checks: this computer, your internet connection and the echo loop test.',
    'Use a cable instead of Wi-Fi if you can, and close other programs and tabs.',
    'Create the event and send the link to your guests. Ask them to use headphones.',
  ] },
  { id: 'during', title: 'During the event', paragraphs: [], steps: [
    'Open the room, then let each guest in from the waiting list.',
    'Press Record all when you are ready. Everyone gets a short count-in so the recordings line up.',
    'Press Stop when the take is done. You can record several takes.',
    'Watch the session clock. You get a warning 15 minutes before the 3 hours end.',
    'End the room when you finish. Guests are sent a thank-you screen.',
  ] },
  { id: 'after', title: 'After the event', paragraphs: [
    'Your own recording is saved on your computer. A guest\'s recording waits on their device until it can be handed over.',
    'Save a take to keep it. Anything you do not save is cleared from this computer when you choose.',
  ] },
  { id: 'obs', title: 'Sending Program into OBS or other software', paragraphs: [
    'On Chrome or Edge on a computer, choose the Program out device during a broadcast. Pick a virtual audio cable, then choose the same cable as the audio input in OBS, StreamYard or your playout software.',
    'Program out never starts on its own, so it cannot cause feedback by surprise.',
  ] },
];

export const PROBLEMS: ReadonlyArray<Problem> = [
  { id: 'no-sound', symptom: 'A guest cannot hear me, or I cannot hear a guest', also: ['silent', 'no audio', 'muted', 'cannot hear'], steps: [
    'Ask the guest to click the page once, then check they are not muted and the volume is up.',
    'Check the guest picked the right headphones in their computer\'s sound settings.',
    'Ask the guest to leave and join the link again.',
    'Check your own input in Live settings, then run the setup assistant\'s microphone test.',
    'If it still fails, the connection may be blocked. Try another network, such as a phone hotspot.',
  ] },
  { id: 'echo', symptom: 'Echo, or guests hear themselves', also: ['feedback', 'hear myself', 'loop', 'mix-minus', 'doubled guest'], steps: [
    'Ask everyone to wear headphones.',
    'If you use a mixer: Uuda\'s output must go to a channel that is not in the send that feeds Uuda. Take that channel out of the aux or mix-minus send.',
    'Run the echo loop test in the setup assistant. It tells you whether the sound is coming back.',
    'Turn the speaker volume down if there are no headphones.',
  ] },
  { id: 'doubled', symptom: 'I sound doubled on air', also: ['double', 'twice', 'host twice', 'phasey'], steps: [
    'Your microphone is on air twice: through the mixer and through Uuda.',
    'In Live settings, set Program contains to Guests only.',
    'Or take your microphone out of the mixer\'s send to Uuda.',
  ] },
  { id: 'level', symptom: 'A guest is too quiet, too loud or distorted', also: ['volume', 'clipping', 'quiet', 'loud', 'distortion'], steps: [
    'Ask the guest to speak about a hand\'s width from the microphone.',
    'In Broadcast, move that guest\'s fader on the desk.',
    'Ask the guest to check no other program is using the microphone.',
    'For a loud or distorted guest, ask them to lower the input volume in their computer\'s sound settings.',
  ] },
  { id: 'choppy', symptom: 'Choppy or robotic sound, delay, or one guest on a poor connection', also: ['lag', 'stutter', 'breaking up', 'robot', 'latency', 'slow'], steps: [
    'Run the connection check in the setup assistant.',
    'Ask the guest to use a cable or sit close to the router, and to close video calls and downloads.',
    'Set Call quality to Standard in Live settings.',
    'If your computer is the slow one, close other tabs and programs. Uuda switches to a Conversation by itself if it is too slow.',
    'The recording on each device is not affected, so you can still use it.',
  ] },
  { id: 'mic-blocked', symptom: 'Microphone blocked, wrong input, or Bluetooth headset trouble', also: ['permission', 'not allowed', 'bluetooth', 'wrong mic', 'headset', 'blocked'], steps: [
    'Click the padlock next to the web address, allow the microphone, and reload the page.',
    'Choose the right input in Live settings.',
    'Close any other program that uses the microphone.',
    'A Bluetooth headset makes the microphone sound like a phone call and adds delay. Use a wired headset instead.',
  ] },
  { id: 'cannot-join', symptom: 'Cannot join: link ended, room full, waiting, or a limit was reached', also: ['full', 'link', 'waiting', 'expired', 'ended', 'limit', 'cannot join'], steps: [
    'Check the link is the newest one and was copied completely.',
    '"Waiting": the host has not opened the room or let you in yet. Stay on the page.',
    'A room holds 4 people including the host.',
    'A session lasts at most 3 hours, and the free plan allows 5 live sessions a week.',
  ] },
  { id: 'relay', symptom: 'A message says the relay is full this month', also: ['relay', 'turn', 'monthly', 'quota'], steps: [
    'Most calls connect directly and never need the relay. This only affects people on strict networks.',
    'Ask the guest to try another network, such as a phone hotspot.',
    'The limit resets at the start of next month.',
  ] },
  { id: 'recording', symptom: 'Recording did not start, is not saved, or the computer ran out of space', also: ['storage', 'disk', 'space', 'sleep', 'not recording', 'lost'], steps: [
    'Look for the red Recording marker on your own screen after you press Record all.',
    'Free some disk space. Recordings need roughly 6 MB for each minute per person.',
    'Stop the computer from going to sleep during the event.',
    'If the page was closed by accident, open Uuda again. It offers to recover the last recording.',
  ] },
  { id: 'take-missing', symptom: 'A guest\'s recording has not arrived', also: ['guest take', 'missing take', 'upload', 'resume', 'hand over'], steps: [
    'Ask the guest to keep that browser and computer unchanged until the hand-over is done.',
    'Guests\' recordings are kept on their device until they can be handed over.',
    'Ask the guest to open the same room link again later.',
  ] },
  { id: 'program-out', symptom: 'Program out device missing, OBS has no sound, or sound and picture are out of sync', also: ['obs', 'streamyard', 'virtual cable', 'output', 'sync', 'lip'], steps: [
    'Use Chrome or Edge on a computer. Other browsers cannot choose an output device.',
    'Install a virtual audio cable and make sure it appears in the computer\'s sound devices.',
    'Choose the cable as the Program out device in the room, then choose the same cable as the audio input in OBS.',
    'For sound and picture out of sync, add a sync offset to the audio in OBS.',
  ] },
  { id: 'browser', symptom: 'My browser or phone is not supported', also: ['safari', 'iphone', 'ipad', 'firefox', 'android', 'unsupported'], steps: [
    'Use Chrome or Edge on a computer to host.',
    'Guests can join from a phone, but a computer is more reliable.',
    'On iPhone, use Safari and keep the page open on screen during the call.',
  ] },
];

export const GUEST_TIPS: ReadonlyArray<string> = [
  'Use headphones. This stops the host from hearing an echo.',
  'Use Chrome or Edge on a computer if you can.',
  'Allow the microphone when your browser asks.',
  'Use a cable or sit close to your router, and close other programs.',
  'Keep this page open until the host says you are done.',
];

export type SearchHit = { kind: 'section'; item: GuideSection } | { kind: 'problem'; item: Problem };

const STOP = new Set(['i', 'a', 'an', 'the', 'can', 'is', 'to', 'my', 'me', 'it', 'in', 'on', 'of', 'and', 'am', 'do', 'does']);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Every word the person typed must appear somewhere in the item. Empty search returns everything. */
export function searchGuide(query: string, sections: ReadonlyArray<GuideSection> = SECTIONS, problems: ReadonlyArray<Problem> = PROBLEMS): SearchHit[] {
  const words = norm(query).split(' ').filter((w) => w && !STOP.has(w));
  const all: SearchHit[] = [...sections.map((item) => ({ kind: 'section' as const, item })), ...problems.map((item) => ({ kind: 'problem' as const, item }))];
  if (words.length === 0) return all;
  return all.filter((h) => {
    const text = norm(h.kind === 'section' ? [h.item.title, ...h.item.paragraphs, ...(h.item.steps ?? [])].join(' ') : [h.item.symptom, ...h.item.also, ...h.item.steps].join(' '));
    return words.every((w) => text.includes(w));
  });
}
