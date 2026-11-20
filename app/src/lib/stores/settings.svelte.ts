// User settings that survive a reload. Phase 3 only has what the skeleton needs.
import { defaultStorage, loadJson, saveJson, type KeyValue } from './persist.ts';

export interface SettingsData {
  /** online mode (docs/pwa-plan.md §6); the default depends on the build */
  online: boolean;
  /** Menu › Appearance › Solid interface */
  solid: boolean;
  resortId: string | null;
}

const KEY = 'openskimap-settings-v1';

export class Settings {
  online = $state(false);
  solid = $state(false);
  resortId = $state<string | null>(null);
  private readonly kv: KeyValue | null;

  constructor(defaults: { online: boolean }, kv: KeyValue | null = defaultStorage()) {
    this.kv = kv;
    const d = loadJson<SettingsData>(kv, KEY, { online: defaults.online, solid: false, resortId: null });
    this.online = d.online;
    this.solid = d.solid;
    this.resortId = d.resortId;
  }

  save(): void {
    saveJson(this.kv, KEY, { online: this.online, solid: this.solid, resortId: this.resortId } satisfies SettingsData);
  }

  setOnline(on: boolean): void {
    this.online = on;
    this.save();
  }

  setResort(id: string): void {
    this.resortId = id;
    this.save();
  }
}
