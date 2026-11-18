import type { LiveMode } from '../events';

/** What the person is doing, what equipment they have, and what that means for Uuda. Plain words; no screens in here. */
export type Goal = 'podcast' | 'radio' | 'on-air';
export type Gear = 'usb-mic' | 'usb-mixer' | 'interface' | 'laptop' | 'bluetooth' | 'analog-desk' | 'digital-desk';

export const GOALS: ReadonlyArray<{ id: Goal; label: string; text: string }> = [
  { id: 'podcast', label: 'A podcast or interview', text: 'Talk with guests and record everyone at full quality.' },
  { id: 'radio', label: 'Internet or community radio', text: 'Put guests on a live stream or a small station.' },
  { id: 'on-air', label: 'On-air radio (transmitter)', text: 'Feed guests into a studio that goes out on the air.' },
];
export const GOAL_IDS: ReadonlyArray<Goal> = GOALS.map((g) => g.id);

export const GEARS: ReadonlyArray<{ id: Gear; label: string; text: string }> = [
  { id: 'usb-mic', label: 'A USB microphone', text: 'One microphone that plugs into the computer with a USB cable.' },
  { id: 'usb-mixer', label: 'A USB mixer or podcast mixer', text: 'A mixer with sliders that connects to the computer with one USB cable.' },
  { id: 'interface', label: 'An audio interface with a microphone', text: 'A small box with microphone sockets (XLR) and a USB cable.' },
  { id: 'laptop', label: 'Just the laptop or a wired headset', text: 'No extra equipment.' },
  { id: 'bluetooth', label: 'A Bluetooth headset or earbuds', text: 'Wireless headphones with a microphone.' },
  { id: 'analog-desk', label: 'A studio desk with no USB', text: 'A mixing desk with sliders, but no USB socket.' },
  { id: 'digital-desk', label: 'A digital desk', text: 'A desk with USB, AES or network audio.' },
];
export const GEAR_IDS: ReadonlyArray<Gear> = GEARS.map((g) => g.id);

export const gearLabel = (g: Gear): string => GEARS.find((x) => x.id === g)?.label ?? g;

/** Gear where a mixer or desk may already put the host on air */
export const isMixerGear = (g: Gear): boolean => g === 'usb-mixer' || g === 'analog-desk' || g === 'digital-desk';

export interface Answers { goal: Goal; gear: Gear; /** The host's own microphone goes through the mixer and onto the air */ hostOnAirViaMixer: boolean }

export interface SetupPlan {
  title: string;
  mode: LiveMode;
  programContains: 'all' | 'guests';
  /** Which picture to draw */
  diagram: 'single' | 'mixer' | 'desk';
  connect: string[];
  /** What Uuda will set, in words */
  settings: string[];
  warnings: string[];
  /** Something the person may need to get */
  needs: string[];
}

export function recommend(a: Answers): SetupPlan {
  const mode: LiveMode = a.goal === 'podcast' ? 'conversation' : 'broadcast';
  const guestsOnly = mode === 'broadcast' && isMixerGear(a.gear) && a.hostOnAirViaMixer;
  const programContains: 'all' | 'guests' = guestsOnly ? 'guests' : 'all';
  const settings = [
    mode === 'broadcast' ? 'New events start as Broadcast: guests connect to you and you mix their sound.' : 'New events start as Conversation: everyone talks to everyone, and each device records at full quality.',
    ...(mode === 'broadcast' ? [guestsOnly ? 'Program out sends only the guests, because your microphone already goes on air through the mixer.' : 'Program out sends you and the guests together.'] : []),
    'Your input is chosen in the next step.',
  ];
  const base = { mode, programContains, settings, warnings: [] as string[], needs: [] as string[] };

  switch (a.gear) {
    case 'usb-mic':
      return { ...base, title: 'USB microphone', diagram: 'single',
        connect: ['Plug the USB microphone straight into the computer.', 'Plug your headphones into the microphone (if it has a headphone socket) or into the computer.', 'Keep the microphone about a hand\'s width from your mouth.'] };
    case 'usb-mixer':
      return { ...base, title: 'USB mixer', diagram: 'mixer',
        connect: [
          'Plug the mixer into the computer with its USB cable.',
          'On the mixer, switch your microphone\'s channel on and raise its slider.',
          mode === 'broadcast'
            ? 'In Uuda, choose the mixer as your microphone input (next step). During a broadcast, also choose the mixer as Program out, so the guests arrive on the mixer\'s USB channel. Raise that channel to hear them and put them on air.'
            : 'In Uuda, choose the mixer as your microphone input (next step). Set the computer\'s sound output to the mixer too, so you hear guests in the mixer\'s headphones.',
          'The mixer must not send its USB channel back to the computer, or guests will hear themselves. Mixers made for podcasting usually take care of this; if a guest says they hear themselves, see "Echo" in the Live guide.',
        ],
        warnings: a.goal === 'podcast' ? [] : ['Check the mixer\'s manual for "USB return", "PC" or "mix-minus" if you are not sure.'] };
    case 'interface':
      return { ...base, title: 'Audio interface', diagram: 'single',
        connect: ['Plug the audio interface into the computer with USB.', 'Plug your microphone into input 1. Switch on "48V" only if your microphone is a condenser type that needs it.', 'Talk and turn the gain knob up until the light flashes green, not red.'] };
    case 'laptop':
      return { ...base, title: 'Laptop or wired headset', diagram: 'single',
        connect: ['Use the computer\'s own microphone, or a wired headset.', 'Wear headphones so the call does not go into your microphone.'],
        warnings: ['The built-in microphone picks up room noise and keyboard sounds. A USB microphone is the easiest big improvement.'] };
    case 'bluetooth':
      return { ...base, title: 'Bluetooth headset', diagram: 'single',
        connect: ['Connect the headset in the computer\'s Bluetooth settings.'],
        warnings: ['Bluetooth headsets drop to a low-quality phone mode when their microphone is in use, and they add delay. Use a wired headset or a USB microphone for anything you want to sound good.'],
        needs: ['A wired headset or a USB microphone'] };
    case 'analog-desk':
      return { ...base, title: 'Studio desk with a USB audio interface', diagram: 'desk',
        connect: [
          'Cable 1: from the desk\'s aux send (a mix-minus or clean feed) to input 1 of the audio interface. It carries your microphone and the studio sources, but not the guests.',
          'Cable 2: from output 1 of the interface to a free channel on the desk. This brings the guests in.',
          'Cable 3: the interface to the computer with USB.',
          'In Uuda, choose the interface as your input, and as Program out during a broadcast.',
        ],
        needs: ['A USB audio interface with 2 inputs and 2 outputs'],
        warnings: ['You need a free aux send on the desk. If yours is already used, ask your engineer for a second one.'] };
    case 'digital-desk':
      return { ...base, title: 'Digital desk', diagram: 'mixer',
        connect: ['Connect the desk to the computer with its USB or network audio.', 'Ask your engineer which channel carries the clean feed to Uuda (your microphone and studio sources, but not the guests) and which channel the guests come back on.', 'In Uuda, choose that input, and the same device as Program out during a broadcast.'],
        warnings: ['A browser may show only two of the desk\'s channels. Your engineer can route the clean feed to channels 1 and 2.'] };
  }
}

/** The "I'm not sure" helper: from what a person can see, the likely setup */
export type Sight = 'sliders' | 'usb-cable' | 'xlr' | 'usb-mic' | 'headset' | 'bluetooth';
export const SIGHTS: ReadonlyArray<{ id: Sight; text: string }> = [
  { id: 'sliders', text: 'A mixing desk or mixer with sliders' },
  { id: 'usb-cable', text: 'A USB cable from that mixer to the computer' },
  { id: 'xlr', text: 'A microphone with a three-pin (XLR) cable' },
  { id: 'usb-mic', text: 'A microphone with a USB plug' },
  { id: 'headset', text: 'Only the laptop\'s microphone, or a headset with a wire' },
  { id: 'bluetooth', text: 'Wireless headphones or earbuds' },
];
export function guessGear(seen: ReadonlyArray<Sight>): { gear: Gear; sure: boolean } {
  const has = (s: Sight) => seen.includes(s);
  if (has('sliders') && has('usb-cable')) return { gear: 'usb-mixer', sure: true };
  if (has('sliders')) return { gear: 'analog-desk', sure: true };
  if (has('xlr')) return { gear: 'interface', sure: true };
  if (has('usb-mic')) return { gear: 'usb-mic', sure: true };
  if (has('bluetooth')) return { gear: 'bluetooth', sure: true };
  if (has('headset')) return { gear: 'laptop', sure: true };
  return { gear: 'laptop', sure: false };
}

/** What sort of sound device a name looks like */
export type DeviceKind = 'bluetooth' | 'builtin' | 'virtual' | 'usb' | 'unknown';
export function classifyDevice(label: string): DeviceKind {
  const l = label.toLowerCase();
  if (/bluetooth|airpods|hands-free|handsfree|buds|beats/.test(l)) return 'bluetooth';
  if (/blackhole|vb-audio|vb-cable|cable output|cable input|loopback|virtual|soundflower|voicemeeter/.test(l)) return 'virtual';
  if (/built-in|builtin|internal|macbook|microphone array|realtek|imac/.test(l)) return 'builtin';
  if (/usb|scarlett|focusrite|yamaha|mackie|behringer|zoom|rode|interface|mixer|presonus|steinberg|motu|universal audio|tascam|alesis|samson|yeti|fifine|maono|podcaster|rodecaster|goxlr|audient|arturia|babyface|ssl/.test(l)) return 'usb';
  return 'unknown';
}

export interface InputDevice { deviceId: string; label: string }
const isPseudo = (d: InputDevice) => d.deviceId === 'default' || d.deviceId === 'communications';

/** The input that most likely matches the equipment, or null when nothing stands out */
export function suggestInput(devices: ReadonlyArray<InputDevice>, gear: Gear): InputDevice | null {
  const real = devices.filter((d) => !isPseudo(d));
  const want: DeviceKind = gear === 'laptop' ? 'builtin' : gear === 'bluetooth' ? 'bluetooth' : 'usb';
  return real.find((d) => classifyDevice(d.label) === want) ?? null;
}

/** A caution when the chosen input does not look like the equipment, or null */
export function inputWarning(label: string, gear: Gear): string | null {
  const k = classifyDevice(label);
  if (k === 'virtual') return 'This looks like a virtual audio cable, not a microphone. Pick your microphone or mixer instead.';
  if (k === 'bluetooth' && gear !== 'bluetooth') return 'This looks like a Bluetooth microphone. Its sound drops to phone quality; a wired input is much better.';
  if (k === 'builtin' && gear !== 'laptop' && gear !== 'bluetooth') return 'This looks like the computer\'s own microphone, not your equipment. Pick the USB device you plugged in.';
  return null;
}
