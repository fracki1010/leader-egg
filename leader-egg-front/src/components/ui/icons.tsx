import type { FC } from 'react';
import type { IconType } from 'react-icons';
import {
  MdHome,
  MdInventory2,
  MdRoute,
  MdAddShoppingCart,
  MdPieChart,
  MdPayments,
  MdAccountBalanceWallet,
  MdAdd,
  MdNotifications,
  MdSettings,
  MdLogout,
  MdMenu,
  MdSearch,
  MdCheck,
  MdClose,
  MdEdit,
  MdDelete,
  MdCall,
  MdLocationOn,
  MdArrowBack,
MdSync,
  MdCloudOff,
  MdCloudDone,
  MdLocalShipping,
  MdMap,
  MdPhoneAndroid,
  MdGroups,
  MdMonetizationOn,
  MdInsights,
  MdDownload,
  MdEggAlt,
  MdWarning,
  MdInfo,
  MdBarChart,
  MdSchedule,
  MdInventory,
  MdPerson,
  MdWhatsapp,
  MdInbox,
  MdLock,
  MdLockOpen,
  MdKey,
  MdPlayArrow,
  MdSkipNext,
  MdArrowForward,
  MdChevronLeft,
  MdRemove,
  MdHistory,
  MdMoreHoriz,
  MdCalendarToday,
  MdCircle,
  MdCheckCircle,
  MdManageAccounts,
  MdTrendingUp,
  MdCreditCard,
  MdRefresh,
  MdFilterAlt,
  MdTune,
  MdChevronRight,
  MdMyLocation,
  MdShoppingCart,
  MdStorefront,
  MdLocalOffer,
  MdPercent,
  MdReceiptLong,
  MdQrCode,
  MdFlag,
  MdEvent,
  MdSwapHoriz,
  MdPointOfSale,
  MdWarehouse,
  MdChat,
  MdVisibilityOff,
  MdMoreVert,
  MdNearMe,
  MdAddCircle,
  MdPersonAdd,
  MdPersonOff,
  MdBadge,
  MdAdminPanelSettings,
  MdVerifiedUser,
  MdSecurity,
  MdPin,
  MdPersonSearch,
  MdSwapVert,
  MdUndo,
  MdDirectionsCar,
  MdAccountBalance,
  MdBolt,
  MdExpandMore,
  MdLightMode,
  MdDarkMode,
  MdAutoAwesome,
} from 'react-icons/md';

/* ═══════════════════════════════════════════════════════════════
   El Huevo Líder — Central icon system
   ═══════════════════════════════════════════════════════════════
   Single family (Material Design / Material Symbols Outlined style)
   so the whole app shares one rounded, friendly visual language.
   Every icon renders at 20px by default and accepts `size` +
   `color` props (react-icons contract). Tree-shakeable: only the
   imported glyphs end up in the bundle.
   ═══════════════════════════════════════════════════════════════ */

export interface IconProps {
  /** Size in px (or any CSS length). Default: 20 */
  size?: number | string;
  /** Icon color */
  color?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Accessible label (renders a <title> element) */
  title?: string;
}

type IconComponent = FC<IconProps>;

function makeIcon(IconSource: IconType, displayName: string): IconComponent {
  const Component: IconComponent = ({ size = 20, color, title, className, style }) => {
    return (
      <IconSource
        size={size}
        color={color}
        title={title}
        className={className}
        style={style}
        aria-hidden={title ? undefined : true}
      />
    );
  };
  Component.displayName = displayName;
  return Component;
}

/* ── Brand ──────────────────────────────────── */

/** Egg — brand mark for El Huevo Líder */
export const IconEgg = makeIcon(MdEggAlt, 'IconEgg');

/* ── Navigation ───────────────────────────────────────────────── */

/** Dashboard / analytics overview */
export const IconDashboard = makeIcon(MdBarChart, 'IconDashboard');
/** Product stock / inventory */
export const IconStock = makeIcon(MdInventory2, 'IconStock');
/** Delivery route */
export const IconRoute = makeIcon(MdRoute, 'IconRoute');
/** Order — also the "Registrar" quick action */
export const IconOrder = makeIcon(MdAddShoppingCart, 'IconOrder');
/** Customer management */
export const IconCustomer = makeIcon(MdPerson, 'IconCustomer');
/** Reports / analytics */
export const IconReport = makeIcon(MdPieChart, 'IconReport');
/** Expense tracking */
export const IconExpense = makeIcon(MdPayments, 'IconExpense');
/** Wallet / cash box */
export const IconWallet = makeIcon(MdAccountBalanceWallet, 'IconWallet');
/** Generic add / new item */
export const IconPlus = makeIcon(MdAdd, 'IconPlus');
/** Notifications */
export const IconBell = makeIcon(MdNotifications, 'IconBell');
/** Settings */
export const IconSettings = makeIcon(MdSettings, 'IconSettings');
/** Log out */
export const IconLogout = makeIcon(MdLogout, 'IconLogout');
/** Home */
export const IconHome = makeIcon(MdHome, 'IconHome');
/** Menu (mobile) */
export const IconMenu = makeIcon(MdMenu, 'IconMenu');
/** Search */
export const IconSearch = makeIcon(MdSearch, 'IconSearch');
/** Confirm / success mark */
export const IconCheck = makeIcon(MdCheck, 'IconCheck');
/** Close / dismiss */
export const IconX = makeIcon(MdClose, 'IconX');
/** Edit */
export const IconEdit = makeIcon(MdEdit, 'IconEdit');
/** Delete */
export const IconDelete = makeIcon(MdDelete, 'IconDelete');
/** Phone */
export const IconPhone = makeIcon(MdCall, 'IconPhone');
/** Call — alias of the phone glyph (quick-contact action) */
export const IconCall = makeIcon(MdCall, 'IconCall');
/** Location pin */
export const IconLocation = makeIcon(MdLocationOn, 'IconLocation');
/** Back navigation */
export const IconArrowBack = makeIcon(MdArrowBack, 'IconArrowBack');
/** Truck / delivery */
export const IconTruck = makeIcon(MdLocalShipping, 'IconTruck');
/** Route map pin */
export const IconMapPin = makeIcon(MdMap, 'IconMapPin');
/** People / customers group */
export const IconUsers = makeIcon(MdGroups, 'IconUsers');
/** Group icon (CustomersPage header identity) */
export const IconGroup = makeIcon(MdGroups, 'IconGroup');
/** Money bag */
export const IconMoney = makeIcon(MdMonetizationOn, 'IconMoney');
/** Trend chart */
export const IconChart = makeIcon(MdInsights, 'IconChart');
/** Download */
export const IconDownload = makeIcon(MdDownload, 'IconDownload');
/** Warning / alert */
export const IconWarning = makeIcon(MdWarning, 'IconWarning');
/** Info */
export const IconInfo = makeIcon(MdInfo, 'IconInfo');

/* ── Supplementary semantic icons ─────────────────────────────── */

/** Clock / pending time */
export const IconClock = makeIcon(MdSchedule, 'IconClock');
/** Crate / box unit (stock, maples) */
export const IconBox = makeIcon(MdInventory, 'IconBox');
/** WhatsApp channel */
export const IconWhatsapp = makeIcon(MdWhatsapp, 'IconWhatsapp');
/** Chat bubble — WhatsApp quick-contact action on customer cards */
export const IconChat = makeIcon(MdChat, 'IconChat');
/** Eye with slash — "ver inactivos" filter toggle */
export const IconVisibilityOff = makeIcon(MdVisibilityOff, 'IconVisibilityOff');
/** Locked padlock — one-time opening balance already loaded */
export const IconLock = makeIcon(MdLock, 'IconLock');
/** Unlocked padlock (credit bypass) */
export const IconLockOpen = makeIcon(MdLockOpen, 'IconLockOpen');
/** Key — password / credentials */
export const IconKey = makeIcon(MdKey, 'IconKey');
/** Inbox / empty state */
export const IconInbox = makeIcon(MdInbox, 'IconInbox');
/** Sync / refresh */
export const IconSync = makeIcon(MdSync, 'IconSync');
/** Cloud with slash — offline banner */
export const IconCloudOff = makeIcon(MdCloudOff, 'IconCloudOff');
/** Cloud with check — reconnected banner */
export const IconCloudDone = makeIcon(MdCloudDone, 'IconCloudDone');
/** Mobile device (PWA install) */
export const IconMobile = makeIcon(MdPhoneAndroid, 'IconMobile');
/** Play / start delivery */
export const IconPlay = makeIcon(MdPlayArrow, 'IconPlay');
/** Forward / skip stop */
export const IconSkip = makeIcon(MdSkipNext, 'IconSkip');
/** Arrow right (swipe direction) */
export const IconArrowRight = makeIcon(MdArrowForward, 'IconArrowRight');
/** Arrow left (swipe direction) */
export const IconArrowLeft = makeIcon(MdChevronLeft, 'IconArrowLeft');
/** Minus / decrement (stock exit) */
export const IconMinus = makeIcon(MdRemove, 'IconMinus');
/** Clock with counterclockwise arrow — transaction history */
export const IconHistory = makeIcon(MdHistory, 'IconHistory');
/** Horizontal ellipsis — "More" menu trigger */
export const IconMore = makeIcon(MdMoreHoriz, 'IconMore');
/** Vertical ellipsis — "More actions" menu trigger (detail pages) */
export const IconMoreVert = makeIcon(MdMoreVert, 'IconMoreVert');
/** Near-me / navigation arrow — "Navegar" action on map snapshots */
export const IconNearMe = makeIcon(MdNearMe, 'IconNearMe');
/** Add inside a circle — prominent quick-order banner CTA */
export const IconAddCircle = makeIcon(MdAddCircle, 'IconAddCircle');
/** Single person — B2C avatar badge / titular contact line */
export const IconPerson = makeIcon(MdPerson, 'IconPerson');
/** Storefront — B2B avatar badge (mayorista) */
export const IconStorefront = makeIcon(MdStorefront, 'IconStorefront');
/** Calendar days — date range filter */
export const IconCalendar = makeIcon(MdCalendarToday, 'IconCalendar');
/** Solid circle — status dot / live indicator */
export const IconCircle = makeIcon(MdCircle, 'IconCircle');
/** Checked circle — delivered / synced confirmation */
export const IconCircleCheck = makeIcon(MdCheckCircle, 'IconCircleCheck');
/** Single user with a gear — user management (admins, drivers, viewers) */
export const IconUserGear = makeIcon(MdManageAccounts, 'IconUserGear');
/** Add a person — "Nuevo usuario" primary action */
export const IconPersonAdd = makeIcon(MdPersonAdd, 'IconPersonAdd');
/** Person with a slash — remove a user from the team */
export const IconPersonOff = makeIcon(MdPersonOff, 'IconPersonOff');
/** Badge / ID card — users & team page identity */
export const IconBadge = makeIcon(MdBadge, 'IconBadge');
/** Admin panel shield — "Acceso completo" admin tile */
export const IconAdminPanelSettings = makeIcon(MdAdminPanelSettings, 'IconAdminPanelSettings');
/** Sun — switch to the light color scheme. */
export const IconLightMode = makeIcon(MdLightMode, 'IconLightMode');
/** Moon — switch to the dark color scheme. */
export const IconDarkMode = makeIcon(MdDarkMode, 'IconDarkMode');
/** Sparkles — AI assistant identity / new-conversation accent. */
export const IconSparkles = makeIcon(MdAutoAwesome, 'IconSparkles');
/** Verified user — "Tú" badge on the current user card */
export const IconVerifiedUser = makeIcon(MdVerifiedUser, 'IconVerifiedUser');
/** Shield — security / role guard. Note: react-icons/md has no
 *  MdShieldPerson glyph, so the shield stands in for it. */
export const IconShieldPerson = makeIcon(MdSecurity, 'IconShieldPerson');
/** PIN pin — security & driver PIN banner */
export const IconPin = makeIcon(MdPin, 'IconPin');
/** Person with magnifier — empty search state */
export const IconPersonSearch = makeIcon(MdPersonSearch, 'IconPersonSearch');
/** Arrow forward — alias of the forward chevron (reference naming) */
export const IconArrowForward = makeIcon(MdArrowForward, 'IconArrowForward');
/** Close — alias of the X dismiss glyph (reference naming) */
export const IconClose = makeIcon(MdClose, 'IconClose');
/** Calendar today — alias of the calendar glyph (reference naming) */
export const IconCalendarToday = makeIcon(MdCalendarToday, 'IconCalendarToday');
/** Local shipping — alias of the truck/delivery glyph */
export const IconLocalShipping = makeIcon(MdLocalShipping, 'IconLocalShipping');

/* ── Dashboard metric icons ────────────────────────────────────── */

/** Upward trend — sales / ventas */
export const IconTrendingUp = makeIcon(MdTrendingUp, 'IconTrendingUp');
/** Credit card — outstanding receivables / por cobrar */
export const IconCreditCard = makeIcon(MdCreditCard, 'IconCreditCard');
/** Rotate-right arrow — refresh button */
export const IconRefresh = makeIcon(MdRefresh, 'IconRefresh');
/** Funnel — collapsible filter panel trigger */
export const IconFilter = makeIcon(MdFilterAlt, 'IconFilter');
/** Sliders — search bar "tune" filter trigger (date range panel) */
export const IconTune = makeIcon(MdTune, 'IconTune');
/** Chevron right — card detail affordance */
export const IconChevronRight = makeIcon(MdChevronRight, 'IconChevronRight');

/** Expand/collapse indicator (rotate 180deg for the expanded state). */
export const IconExpandMore = makeIcon(MdExpandMore, 'IconExpandMore');
/** Crosshair / my-location — GPS recenter control on maps */
export const IconMyLocation = makeIcon(MdMyLocation, 'IconMyLocation');

/* ── Purchases / suppliers ─────────────────────────────────────── */

/** Shopping cart — purchases / compras */
export const IconShoppingCart = makeIcon(MdShoppingCart, 'IconShoppingCart');
/** Storefront — suppliers / proveedores */
export const IconStore = makeIcon(MdStorefront, 'IconStore');

/* ── Vehicles ───────────────────────────────────────────────────── */

/** Car — vehicles / vehículos */
export const IconDirectionsCar = makeIcon(MdDirectionsCar, 'IconDirectionsCar');
/** Car — alias of the directions-car glyph (reference naming) */
export const IconCar = makeIcon(MdDirectionsCar, 'IconCar');

/* ── Promotions ─────────────────────────────────────────── */

/** Tag / local offer — promotions / promos */
export const IconPromo = makeIcon(MdLocalOffer, 'IconPromo');
/** Percent — discount promo badge */
export const IconDiscount = makeIcon(MdPercent, 'IconDiscount');
/** Percent — partial payment / percentage glyph */
export const IconPercent = makeIcon(MdPercent, 'IconPercent');

/* ── Order creation (NewOrderPage) ──────────────────────── */

/** Payments — payment method section header */
export const IconPayments = makeIcon(MdPayments, 'IconPayments');
/** Receipt — order summary header */
export const IconReceiptLong = makeIcon(MdReceiptLong, 'IconReceiptLong');
/** QR code — transfer/QR payment option */
export const IconQrCode = makeIcon(MdQrCode, 'IconQrCode');

/** Bank / account balance — Banco (money account) balance card. */
export const IconBank = makeIcon(MdAccountBalance, 'IconBank');
/** Flag — logistics priority */
export const IconFlag = makeIcon(MdFlag, 'IconFlag');
/** Calendar event — delivery day */
export const IconEvent = makeIcon(MdEvent, 'IconEvent');
/** Swap horizontal — "Cambiar" customer action */
export const IconSwapHoriz = makeIcon(MdSwapHoriz, 'IconSwapHoriz');
/** Swap vertical — reorder / optimize route stops */
export const IconSwapVert = makeIcon(MdSwapVert, 'IconSwapVert');
/** Undo / return — "Registrar devolución" action and return movements */
export const IconUndo = makeIcon(MdUndo, 'IconUndo');
/** Point of sale terminal — cash payment option */
export const IconPointOfSale = makeIcon(MdPointOfSale, 'IconPointOfSale');

/* ── Dashboard / admin reference icons ───────────────────────── */

/** Warehouse — Depósito Central stock section */
export const IconWarehouse = makeIcon(MdWarehouse, 'IconWarehouse');
/** Bolt — quick actions section header */
export const IconBolt = makeIcon(MdBolt, 'IconBolt');
/** Notifications bell — alias of the brand bell */
export const IconNotifications = makeIcon(MdNotifications, 'IconNotifications');