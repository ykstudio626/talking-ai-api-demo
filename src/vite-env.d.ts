/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAINTENANCE_MODE?: string;
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_DEMO_MODE_RESTRICTION?: string;
  readonly EVENT_LOG?: string;

}
