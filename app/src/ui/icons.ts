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
import Share from '@lucide/svelte/icons/share';
import ChevronDown from '@lucide/svelte/icons/chevron-down';
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import ChevronLeft from '@lucide/svelte/icons/chevron-left';
import Check from '@lucide/svelte/icons/check';
import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
import Footprints from '@lucide/svelte/icons/footprints';
import ArrowUp from '@lucide/svelte/icons/arrow-up';
import ArrowDown from '@lucide/svelte/icons/arrow-down';
import Undo2 from '@lucide/svelte/icons/undo-2';
import Redo2 from '@lucide/svelte/icons/redo-2';
import Folder from '@lucide/svelte/icons/folder';
import CircleCheck from '@lucide/svelte/icons/circle-check';
import CircleMinus from '@lucide/svelte/icons/circle-minus';
import Maximize2 from '@lucide/svelte/icons/maximize-2';
import Minus from '@lucide/svelte/icons/minus';
import Plus from '@lucide/svelte/icons/plus';
import LocateFixed from '@lucide/svelte/icons/locate-fixed';

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
  share: Share,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronLeft: ChevronLeft,
  check: Check,
  slidersHorizontal: SlidersHorizontal,
  footprints: Footprints,
  arrowUp: ArrowUp,
  arrowDown: ArrowDown,
  undo2: Undo2,
  redo2: Redo2,
  folder: Folder,
  circleCheck: CircleCheck,
  circleMinus: CircleMinus,
  maximize2: Maximize2,
  minus: Minus,
  plus: Plus,
  locateFixed: LocateFixed,
};

export type IconName = keyof typeof icons;
