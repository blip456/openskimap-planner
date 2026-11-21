// User settings that survive a reload: online mode, solid interface, keep screen on, the open resort.
import { defaultStorage, loadJson, saveJson, type KeyValue } from './persist.ts';

export interface SettingsData {
  /** online mode (docs/pwa-plan.md §6); the default depends on the build */
  online: boolean;
  /** Menu › Appearance › Solid interface */
  solid: boolean;
  /** Menu › Appearance › Keep screen on while planning (Screen Wake Lock) */
  keepAwake: boolean;
  resortId: string | null;
}

const KEY = 'openskimap-settings-v1';

export class Settings {
  online = $state(false);
  solid = $state(false);
  keepAwake = $state(false);
  resortId = $state<string | null>(null);
  private readonly kv: KeyValue | null;

  constructor(defaults: { online: boolean }, kv: KeyValue | null = defaultStorage()) {
    this.kv = kv;
    const d = loadJson<SettingsData>(kv, KEY, { online: defaults.online, solid: false, keepAwake: false, resortId: null });
    this.online = d.online;
    this.solid = d.solid;
    this.keepAwake = d.keepAwake === true;
    this.resortId = d.resortId;
  }

  save(): void {
    saveJson(this.kv, KEY, { online: this.online, solid: this.solid, keepAwake: this.keepAwake, resortId: this.resortId } satisfies SettingsData);
  }

  setOnline(on: boolean): void {
    this.online = on;
    this.save();
  }

  setSolid(on: boolean): void {
    this.solid = on;
    this.save();
  }

  setKeepAwake(on: boolean): void {
    this.keepAwake = on;
    this.save();
  }

  setResort(id: string): void {
    this.resortId = id;
    this.save();
  }
}
