// Small types shared by the map component and the app shell.

/** The parts of the map covered by sheets or the desktop panel (px). */
export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** What the app shell can ask the map to do (zoom buttons, compass). */
export interface MapApi {
  zoomIn: () => void;
  zoomOut: () => void;
  resetNorth: () => void;
}
