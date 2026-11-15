// The shared template rules (server/templateService.ts -> src/templates/template.ts) import browser-typed audio code.
// The Worker never runs that audio code; these placeholders let it type-check without adding the whole DOM library
// (which changes how Uint8Array and BufferSource are checked for the Worker's own code).
declare type AudioBuffer = any;
declare type AudioNode = any;
declare type AudioParam = any;
declare type BaseAudioContext = any;
declare type OfflineAudioContext = any;
declare type HTMLElement = any;
declare const AudioBuffer: any;
declare const OfflineAudioContext: any;
