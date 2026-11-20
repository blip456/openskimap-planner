// Icons used by the UI (Lucide, one import per icon so only these are bundled). Spec §7.
// Lucide 1.77 renamed two icons of the spec table: trash-2 → trash, triangle-alert → triangle-exclamation-point
// (the old names are aliases without type declarations), so the new names are used.
import Bookmark from '@lucide/svelte/icons/bookmark';
import Box from '@lucide/svelte/icons/box';
import CircleX from '@lucide/svelte/icons/circle-x';
import FileDown from '@lucide/svelte/icons/file-down';
import HardDrive from '@lucide/svelte/icons/hard-drive';
import MapIcon from '@lucide/svelte/icons/map';
import Menu from '@lucide/svelte/icons/menu';
import Navigation from '@lucide/svelte/icons/navigation';
import Pencil from '@lucide/svelte/icons/pencil';
import RouteIcon from '@lucide/svelte/icons/route';
import Search from '@lucide/svelte/icons/search';
import Trash from '@lucide/svelte/icons/trash';
import TriangleAlert from '@lucide/svelte/icons/triangle-exclamation-point';
import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';
import Wrench from '@lucide/svelte/icons/wrench';
import X from '@lucide/svelte/icons/x';

export const icons = {
  bookmark: Bookmark,
  box: Box,
  circleX: CircleX,
  fileDown: FileDown,
  hardDrive: HardDrive,
  map: MapIcon,
  menu: Menu,
  navigation: Navigation,
  pencil: Pencil,
  route: RouteIcon,
  search: Search,
  trash: Trash,
  triangleAlert: TriangleAlert,
  arrowUpDown: ArrowUpDown,
  wrench: Wrench,
  x: X,
};

export type IconName = keyof typeof icons;
