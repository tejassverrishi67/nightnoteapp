export interface AppSettings {
  reminderTime: string;
  inputMode: 'Voice' | 'Text';
  darkTheme: boolean;
  morningAlert: boolean;
  middayNudge: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  reminderTime: '22:00',
  inputMode: 'Voice',
  darkTheme: false,
  morningAlert: true,
  middayNudge: false,
};

export function getSettings(): AppSettings {
  try {
    const stored = localStorage.getItem('appSettings');
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to parse settings', e);
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem('appSettings', JSON.stringify(settings));
}
