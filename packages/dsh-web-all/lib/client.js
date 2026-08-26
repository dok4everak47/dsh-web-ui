window.__ModuleLoader__.load({
	id: "@linxin666/dsh-web-all",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/sidebar-memory.ts
		/**
		* Sidebar collapsed-state memory.
		*
		* The official dsh web shell keeps the sidebar fold state in a transient
		* React store (the ui-layout panel store `init` always boots the sidebar
		* open at 280px); it is never written to a store, localStorage, or
		* settings, so every fresh page load starts the column expanded. This
		* module persists the last user-chosen fold state in localStorage and
		* restores it across reloads.
		*
		* First-paint restore (the important part)
		* ----------------------------------------
		* The shell's `runPluginBoot` awaits EVERY plugin module import, and only
		* AFTER all of them settle does it create and render the APP_SHELL layout
		* frame. That means module top-level code here runs BEFORE the frame's
		* first paint. We use that window: when the persisted state is collapsed,
		* {@link installPreCollapseCss} injects a render-blocking `<style>` at
		* import time that forces the frame grid to its 56px rail geometry with
		* `!important`. The frame therefore paints already collapsed -- there is
		* no expanded first frame and no collapse transition to suppress.
		*
		* Once the shell commits the real collapsed state (the frame carries
		* `data-sidebar-collapsed`) the pre-collapse stylesheet is removed; the
		* shell's own rules resolve to the same 56px rail, so removal causes no
		* visual change. A runtime call to `layout.toggleSidebar()` still flips
		* the React store so subsequent manual toggles and drag resize behave
		* correctly; it changes nothing visible because the frame is already at
		* the target width.
		*
		* Safety-first design (this runs on every page, including while the user
		* types, so it must not fight the shell or cause layout feedback):
		*
		*  - No MutationObserver on the sidebar: React re-renders during typing
		*    could fire observers and create a width-read/localStorage-write
		*    feedback loop with the shell's focus management. We persist only at
		*    natural pause points (pagehide, visibilitychange to hidden, and a
		*    slow 5-second heartbeat). None of these run per keystroke.
		*  - A single document-level MO only watches for the frame to gain/lose
		*    `data-sidebar-collapsed`; it reacts to attribute changes, not the
		*    per-keystroke DOM churn, and disconnects as soon as the boot state
		*    is resolved.
		*  - Width-based state detection: offsetWidth < 120px classifies the 56px
		*    rail; anything wider is expanded. We never read hashed css-module
		*    class names, so detection survives shell rc upgrades.
		*  - The pre-collapse grid override is gated to desktop widths
		*    (>= 1025px) so it never fights the shell's narrow/over-the-shell
		*    mobile sidebar.
		*  - No synthetic button click: a programmatic click on the shell's
		*    toggle button could scroll it into view and steal focus.
		*  - Kill switch: setting localStorage `dsh:sidebar-memory` to `"off"`
		*    before load disables the feature entirely (refresh to apply).
		*
		* Every external access is defensive: missing sidebar, storage that
		* throws in private mode, a layout service that disappears mid-run, and a
		* sidebar that never mounts all degrade to a no-op.
		* @module dsh-web-all/client/sidebar-memory
		*/
		/** localStorage key under which the last collapsed flag is stored. */
		const STORAGE_KEY = "dsh:sidebar-collapsed";
		/** Kill switch: when set to "off" the controller never installs. */
		const DISABLE_KEY = "dsh:sidebar-memory";
		/**
		* Widths below this threshold are treated as the collapsed rail. The
		* shell's rail is 56px and its expanded column starts around 240px; a
		* midpoint gives a wide margin against future tweaks.
		*/
		const COLLAPSED_WIDTH_THRESHOLD = 120;
		/** The shell's desktop sidebar rail width, matching computeCols(sidebar=0). */
		const RAIL_WIDTH_PX = 56;
		/**
		* Above this viewport the sidebar is an in-flow grid column (the shell's
		* SIDEBAR_AUTO_COLLAPSE breakpoint). At or below it the sidebar becomes an
		* over-the-shell overlay, so the pre-collapse grid override must not
		* apply there.
		*/
		const DESKTOP_MIN_WIDTH_PX = 1025;
		/** Watcher tick for the runtime restore/persist settle loop. */
		const TICK_MS = 16;
		/** Give up waiting for the sidebar to mount after this long. */
		const RESTORE_WATCH_MS = 1e4;
		/**
		* After the frame gains `data-sidebar-collapsed`, keep the pre-collapse
		* clipping and the descendant `animation/transition: none` override in
		* place for this long before releasing. The shell mounts the sidebar's
		* inner content in two waves even when the frame is already at rail width:
		* an expanded (`wide-in`) wave around ~520ms, then the rail (`rail-in`)
		* wave around ~700ms. Releasing the instant the frame is marked collapsed
		* lets that internal wide-to-rail switch animate on screen; holding past
		* both waves keeps the column clipped and static until the shell has
		* settled into its final rail state.
		*/
		const SETTLE_HOLD_MS = 900;
		/** Heartbeat for persisting state on long-lived pages that never hide. */
		const HEARTBEAT_MS = 5e3;
		/** Attribute identifying stylesheets owned by this module. */
		const STYLE_ATTR = "data-dsh-sidebar-memory";
		/**
		* First-paint pre-collapse CSS. Injected at module import time, before the
		* shell frame renders, so the frame's first paint already uses the 56px
		* rail. `!important` beats the frame's inline `gridTemplateColumns`
		* (280px at boot). Scoped to desktop and to a html-level marker so the
		* runtime controller can remove it the moment the shell commits the real
		* collapsed state.
		*
		* The sidebar column gets `overflow:hidden` so its expanded-width content
		* (search box, entry labels) is clipped to the rail for the handful of
		* frames before the shell applies its own collapsed layout. The center
		* column is untouched (its `minmax(0,1fr)` already absorbs the freed
		* space).
		*/
		/** Attribute on <html> that holds the pre-collapse geometry until shell commit. */
		const PRE_COLLAPSE_ATTR = "data-dsh-sidebar-precollapse";
		/**
		* Marker on the permanent stylesheet that mutes the sidebar's one-shot
		* mount keyframes (`rail-in`, `wide-in`, ...). Unlike the geometry sheet
		* this one is never removed: CSS animations outrank author `!important` on
		* `opacity`/`transform`, so the only way to flatten them is
		* `animation: none`, and removing that would replay the animation from the
		* start. The sidebar's manual fold is driven by transitions (column width,
		* `max-width`), not animations, so silencing animations does not affect
		* folding; it only stops the boot-time fade/slide from ever playing on a
		* collapsed restore.
		*/
		const NO_ANIM_ATTR_VALUE = "sidebar-no-anim";
		/**
		* Resolve the layout frame element (the grid that parents the sidebar
		* column). We target it structurally rather than by a hashed class name so
		* this survives shell rc upgrades.
		*/
		function findFrame() {
			const sidebar = document.querySelector("[class*=\"sidebarCol\"]");
			return sidebar?.parentElement instanceof HTMLElement ? sidebar.parentElement : null;
		}
		/** Find the shell sidebar column. */
		function findSidebar() {
			return document.querySelector("[class*=\"sidebarCol\"], [data-pane=\"sidebar\"]");
		}
		/**
		* Inject the pre-collapse stylesheet synchronously. Called once at module
		* import. Returns the injected style element, or null when not needed.
		*/
		function injectPreCollapseStyle() {
			if (typeof document === "undefined") return null;
			if (readPersisted() !== true) return null;
			if (isDisabled()) return null;
			const css = `
@media (min-width: ${DESKTOP_MIN_WIDTH_PX}px) {
  html[${PRE_COLLAPSE_ATTR}] [class*="frame"]:has([class*="sidebarCol"]) {
    grid-template-columns: ${RAIL_WIDTH_PX}px minmax(0, 1fr) 0px !important;
    transition: none !important;
  }
  html[${PRE_COLLAPSE_ATTR}] [class*="sidebarCol"],
  html[${PRE_COLLAPSE_ATTR}] [class*="sidebarCol"] * {
    transition: none !important;
  }
  html[${PRE_COLLAPSE_ATTR}] [class*="sidebarCol"] {
    width: ${RAIL_WIDTH_PX}px !important;
    max-width: ${RAIL_WIDTH_PX}px !important;
    min-width: ${RAIL_WIDTH_PX}px !important;
    overflow: hidden !important;
  }
}
`;
			const style = document.createElement("style");
			style.setAttribute(STYLE_ATTR, "precollapse");
			style.textContent = css;
			document.documentElement.setAttribute(PRE_COLLAPSE_ATTR, "");
			(document.head ?? document.documentElement).appendChild(style);
			if (!document.querySelector(`style[${STYLE_ATTR}="${NO_ANIM_ATTR_VALUE}"]`)) {
				const mute = document.createElement("style");
				mute.setAttribute(STYLE_ATTR, NO_ANIM_ATTR_VALUE);
				mute.textContent = `
@media (min-width: ${DESKTOP_MIN_WIDTH_PX}px) {
  [class*="sidebarCol"],
  [class*="sidebarCol"] * {
    animation: none !important;
  }
}
`;
				(document.head ?? document.documentElement).appendChild(mute);
			}
			return style;
		}
		/** Read the persisted collapsed flag; null when never stored / storage fails. */
		function readPersisted() {
			try {
				const raw = localStorage.getItem(STORAGE_KEY);
				if (raw === "1") return true;
				if (raw === "0") return false;
				return null;
			} catch {
				return null;
			}
		}
		/** Persist the collapsed flag. Silent on storage failure. */
		function writePersisted(collapsed) {
			try {
				localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
			} catch {}
		}
		/** True when the user has turned off the feature via the kill switch. */
		function isDisabled() {
			try {
				return localStorage.getItem(DISABLE_KEY) === "off";
			} catch {
				return false;
			}
		}
		/**
		* Classify a sidebar element by its measured width. A zero-width element
		* returns undefined so callers skip persisting a false reading.
		*/
		function isCollapsedByWidth(sidebar) {
			const width = sidebar.offsetWidth;
			if (width <= 0) return void 0;
			return width < COLLAPSED_WIDTH_THRESHOLD;
		}
		/**
		* Install the sidebar memory controller. Idempotent.
		*
		* The pre-collapse stylesheet is already in the DOM from the import-time
		* {@link injectPreCollapseStyle} call; this function takes over once the
		* cordis context is live: it flips the React store to match, watches for
		* the shell to commit the real collapsed state so the pre-collapse sheet
		* can be removed, and persists future toggles.
		*
		* @param layout - the cordis layout service when reachable.
		* @returns disposer that stops all listeners and timers.
		*/
		function installSidebarMemory(layout) {
			if (installAnchor !== void 0) return installAnchor;
			if (isDisabled()) return () => {};
			let disposed = false;
			let sidebar = null;
			let restored = false;
			let watchTimer;
			let bootTimer;
			let heartbeatTimer;
			let lastPersisted = readPersisted();
			let preCollapseStyle = document.querySelector(`style[${STYLE_ATTR}="precollapse"]`);
			let mo;
			let holdTimer;
			let resolved = false;
			const stopTimers = () => {
				if (watchTimer !== void 0) {
					clearTimeout(watchTimer);
					watchTimer = void 0;
				}
				if (bootTimer !== void 0) {
					clearTimeout(bootTimer);
					bootTimer = void 0;
				}
				if (holdTimer !== void 0) {
					clearTimeout(holdTimer);
					holdTimer = void 0;
				}
			};
			/** Drop the pre-collapse geometry; the shell's own state now owns it. The
			*  mount-animation mute intentionally stays installed (it is removed only
			*  on dispose) so boot keyframes can never replay when geometry hands off. */
			const releasePreCollapse = () => {
				if (resolved) return;
				resolved = true;
				document.documentElement.removeAttribute(PRE_COLLAPSE_ATTR);
				if (preCollapseStyle !== null) {
					preCollapseStyle.remove();
					preCollapseStyle = null;
				}
				if (mo !== void 0) {
					mo.disconnect();
					mo = void 0;
				}
				if (bootTimer !== void 0) {
					clearTimeout(bootTimer);
					bootTimer = void 0;
				}
				if (holdTimer !== void 0) {
					clearTimeout(holdTimer);
					holdTimer = void 0;
				}
			};
			const cleanup = () => {
				disposed = true;
				stopTimers();
				releasePreCollapse();
				document.querySelector(`style[${STYLE_ATTR}="${NO_ANIM_ATTR_VALUE}"]`)?.remove();
				if (heartbeatTimer !== void 0) clearInterval(heartbeatTimer);
				window.removeEventListener("pagehide", persistNow);
				document.removeEventListener("visibilitychange", onVisibilityChange);
				sidebar = null;
				installAnchor = void 0;
			};
			installAnchor = cleanup;
			/** Read the current width and persist it if it changed. */
			const persistNow = () => {
				if (disposed) return;
				const current = sidebar !== null ? isCollapsedByWidth(sidebar) : void 0;
				if (current === void 0) return;
				if (lastPersisted !== current) {
					lastPersisted = current;
					writePersisted(current);
				}
			};
			const onVisibilityChange = () => {
				if (document.visibilityState === "hidden") persistNow();
			};
			/**
			* Watch for the frame to gain/lose `data-sidebar-collapsed`. We do NOT
			* release the instant the frame is marked collapsed: the shell mounts the
			* sidebar inner content in a wide wave then a rail wave, so the column
			* stays clipped with descendant animations suppressed for
			* {@link SETTLE_HOLD_MS} after that point (see the constant). The observer
			* is attribute-only, so it never reacts to per-keystroke content churn.
			*/
			const observeFrame = (frame) => {
				const check = () => {
					if (disposed || resolved) return;
					if (lastPersisted === false) {
						releasePreCollapse();
						return;
					}
					if (!frame.hasAttribute("data-sidebar-collapsed")) return;
					if (mo !== void 0) {
						mo.disconnect();
						mo = void 0;
					}
					if (bootTimer !== void 0) {
						clearTimeout(bootTimer);
						bootTimer = void 0;
					}
					holdTimer = setTimeout(releasePreCollapse, SETTLE_HOLD_MS);
				};
				check();
				if (resolved) return;
				mo = new MutationObserver(check);
				mo.observe(frame, {
					attributes: true,
					attributeFilter: ["data-sidebar-collapsed"]
				});
				bootTimer = setTimeout(releasePreCollapse, RESTORE_WATCH_MS);
			};
			/**
			* Restore the persisted state now that the sidebar has mounted with a
			* readable width. Runs at most once. The pre-collapse CSS already made
			* the frame paint at the rail width; here we only reconcile the React
			* store and arrange to hand off to the shell's own collapsed styling.
			*/
			const restore = () => {
				if (sidebar === null) return;
				restored = true;
				const current = isCollapsedByWidth(sidebar);
				if (current === void 0) return;
				if (lastPersisted === null) {
					lastPersisted = current;
					writePersisted(current);
					releasePreCollapse();
					return;
				}
				const frame = findFrame();
				if (frame !== null) observeFrame(frame);
				else releasePreCollapse();
				if (!(preCollapseStyle !== null ? lastPersisted === true && !frame?.hasAttribute("data-sidebar-collapsed") : lastPersisted !== current)) return;
				if (layout === void 0) return;
				try {
					layout.toggleSidebar();
				} catch {
					return;
				}
				lastPersisted = true;
			};
			/** Poll until the sidebar column mounts with a readable width. */
			const watchForSidebar = (budgetLeft) => {
				watchTimer = setTimeout(() => {
					watchTimer = void 0;
					if (disposed || restored) return;
					const found = sidebar ?? findSidebar();
					if (found !== null) {
						sidebar = found;
						if (isCollapsedByWidth(found) !== void 0) {
							restore();
							return;
						}
					}
					if (budgetLeft <= TICK_MS) {
						releasePreCollapse();
						return;
					}
					watchForSidebar(budgetLeft - TICK_MS);
				}, TICK_MS);
			};
			watchForSidebar(RESTORE_WATCH_MS);
			window.addEventListener("pagehide", persistNow, { passive: true });
			document.addEventListener("visibilitychange", onVisibilityChange, { passive: true });
			heartbeatTimer = setInterval(persistNow, HEARTBEAT_MS);
			return cleanup;
		}
		let installAnchor;
		injectPreCollapseStyle();
		//#endregion
		//#region src/client/index.ts
		/** Column shims: element selector → attribute to stamp. */
		const COLUMN_SHIMS = [
			["[class*=\"sidebarCol\"]", "data-pane=\"sidebar\""],
			["[class*=\"centerCol\"]", "data-pane=\"conversation\""],
			["[class*=\"detailsCol\"]", "data-pane=\"details\""]
		];
		/** Stable hooks consumed by the responsive compat layer (never text/hash selectors). */
		const RESPONSIVE_CSS = `
[data-dsh-frame] { min-height: 0; }
[data-dsh-frame] [data-dsh-responsive-part="composer"],
[data-dsh-frame] [data-dsh-responsive-part="sidebar-toggle"],
  [data-dsh-frame] [data-dsh-responsive-part="menu"] { touch-action: manipulation; }
@media (max-width: 768px) {
  [data-dsh-frame] [data-dsh-responsive-part="sidebar-toggle"] { min-width: 44px; min-height: 44px; }
  [data-dsh-frame] {
    height: 100dvh;
    min-height: 100dvh;
    grid-template-columns: minmax(0, 1fr) !important;
    grid-template-rows: 100%;
    padding-bottom: env(safe-area-inset-bottom);
  }
  [data-dsh-frame] [data-pane="sidebar"] {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    z-index: 1100;
    width: min(88vw, 320px) !important;
    max-width: 100%;
    box-shadow: 0 12px 32px rgb(0 0 0 / 24%);
    transform: translateX(0);
    transition: transform 160ms ease;
  }
  [data-dsh-frame]:not([data-sidebar-collapsed])::after {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 1050;
    background: rgb(0 0 0 / 24%);
  }
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] {
    width: 52px !important;
    transform: none;
    pointer-events: none;
    background: transparent !important;
    border: 0 !important;
    box-shadow: none;
  }
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] > [data-slot="sidebar"] > :first-child > :not(:first-child),
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] > [data-slot="sidebar"] > :first-child > :first-child > :not([data-dsh-responsive-part="sidebar-toggle"]) {
    display: none !important;
  }
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] > [data-slot="sidebar"],
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] > [data-slot="sidebar"] > :first-child { background: transparent !important; }
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] [data-dsh-responsive-part="sidebar-toggle"] {
    pointer-events: auto;
    display: inline-flex !important;
  }
  /* Center-view plugins own this marker; the aggregate shell owns its mobile offset. */
  [data-dsh-frame][data-sidebar-collapsed] [data-dsh-center-view-back] {
    margin-inline-start: 52px;
  }
  [data-dsh-frame] [data-pane="conversation"] {
    min-width: 0;
    width: 100%;
    min-height: 0;
  }
  [data-dsh-frame] [data-pane="details"] {
    display: none;
  }
  [data-dsh-frame]:not([data-details-collapsed]) [data-pane="details"] {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 1000;
    width: 100%;
    background: var(--dsw-alias-bg-base);
  }
  [data-dsh-frame][data-details-collapsed] [data-pane="details"] {
    display: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="composer"] {
    max-width: 100%;
    padding-inline: max(8px, env(safe-area-inset-left)) max(8px, env(safe-area-inset-right));
  }
  [data-dsh-frame] [data-slot="conversation.composer"],
  [data-dsh-frame] [data-composer-card],
  [data-dsh-frame] [data-input-scroll] {
    min-width: 0;
    max-width: 100%;
  }
  [data-dsh-frame] [data-composer-card] > :last-child {
    min-width: 0;
    max-width: 100%;
    flex-wrap: wrap;
  }
  [data-dsh-frame] [data-slot="conversation.input.model"] {
    min-width: 0;
    max-width: 45%;
  }
  [data-dsh-frame] [data-slot="conversation.input.model"] :is(button, span) {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  [data-dsh-frame] textarea[data-phase] {
    min-width: 0;
    font-size: 16px;
  }
  [data-dsh-part="summon-button"] {
    right: max(12px, env(safe-area-inset-right));
    bottom: max(12px, env(safe-area-inset-bottom));
    z-index: 40 !important;
    width: 44px !important;
    height: 44px !important;
    min-width: 44px;
    min-height: 44px;
    padding: 0 !important;
    border-radius: 50% !important;
    font-size: 0 !important;
  }
  [data-dsh-part="summon-button"]::before {
    content: "";
    display: block;
    width: 18px;
    height: 13px;
    margin: auto;
    border: 2px solid currentColor;
    border-radius: 55% 65% 45% 55%;
    transform: rotate(-8deg);
  }
  [data-dsh-frame] [data-dsh-responsive-part="code"] {
    max-width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  [data-dsh-frame] [data-dsh-responsive-part="menu"] {
    max-width: min(92vw, 360px);
  }
}
@media (max-width: 768px) {
  [data-dsh-frame] [data-dsh-responsive-part="conversation-header"] {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: minmax(32px, auto) minmax(44px, auto);
    column-gap: 8px;
    padding: 8px 8px 0 60px !important;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-title-row"] {
    display: contents;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-title-cluster"] {
    box-sizing: border-box;
    grid-column: 1 / -1;
    grid-row: 1;
    min-width: 0;
    padding-inline-end: 44px;
    overflow: hidden;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-tablist"] {
    grid-column: 1;
    grid-row: 2;
    min-width: 0;
    margin-top: 0;
    padding-left: 0;
    gap: 16px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-tablist"]::-webkit-scrollbar {
    display: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-tablist"] > [role="tab"] {
    min-height: 44px;
    flex: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-utilities"] {
    grid-column: 2;
    grid-row: 2;
    z-index: 2;
    max-width: 42vw;
    min-height: 44px;
    margin-left: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-utilities"]::-webkit-scrollbar {
    display: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-utilities"] :is(button, [role="button"]) {
    min-width: 44px;
    min-height: 44px;
    flex: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-dsh-frame] [data-pane="sidebar"] { transition: none; }
}
`;
		function ensureResponsiveStyle() {
			const existing = document.querySelector("style[data-dsh-compat=\"responsive\"]");
			if (existing !== null) return existing;
			const style = document.createElement("style");
			style.dataset.dshCompat = "responsive";
			style.textContent = RESPONSIVE_CSS;
			document.head.appendChild(style);
			return style;
		}
		function stampSemanticParts(frame) {
			let changed = false;
			const mark = (element, part) => {
				if (element.getAttribute("data-dsh-responsive-part") === part) return;
				element.setAttribute("data-dsh-responsive-part", part);
				changed = true;
			};
			frame.querySelectorAll("[data-slot=\"conversation.composer\"], [data-composer-card], [data-input-scroll], textarea[data-phase], [contenteditable=\"true\"]").forEach((element) => mark(element, "composer"));
			frame.querySelectorAll("pre").forEach((element) => mark(element, "code"));
			frame.querySelectorAll("[role=\"menu\"], [data-subagent-menu]").forEach((element) => mark(element, "menu"));
			frame.querySelectorAll("[role=\"treeitem\"]:not([data-dsh-part])").forEach((element) => mark(element, "sidebar-entry"));
			const conversation = frame.querySelector("[data-pane=\"conversation\"]");
			const slottedHeader = (conversation?.querySelector("[data-slot=\"conversation.session.header\"]"))?.querySelector(":scope > header") ?? null;
			const scrollport = conversation?.querySelector("[data-conversation-scroll]") ?? null;
			const siblingHeader = scrollport?.previousElementSibling ?? null;
			const conversationHeader = slottedHeader ?? (siblingHeader?.tagName === "HEADER" && siblingHeader.parentElement === scrollport?.parentElement ? siblingHeader : null);
			if (conversationHeader !== null) {
				mark(conversationHeader, "conversation-header");
				const titleRow = conversationHeader.firstElementChild;
				if (titleRow !== null && titleRow.getAttribute("role") !== "tablist") {
					mark(titleRow, "session-title-row");
					const titleCluster = titleRow.firstElementChild;
					const utilities = titleCluster?.nextElementSibling;
					if (titleCluster !== null && titleCluster !== void 0) mark(titleCluster, "session-title-cluster");
					if (utilities !== null && utilities !== void 0) mark(utilities, "session-utilities");
				}
				const tablist = conversationHeader.querySelector(":scope > [role=\"tablist\"]");
				if (tablist !== null) mark(tablist, "session-tablist");
			}
			const logoButtons = ((frame.querySelector("[data-pane=\"sidebar\"]")?.querySelector(":scope > [data-slot=\"sidebar\"]"))?.firstElementChild?.firstElementChild)?.querySelectorAll(":scope > button, :scope > [role=\"button\"]");
			const toggle = logoButtons?.item((logoButtons.length || 1) - 1);
			if (toggle !== null && toggle !== void 0) mark(toggle, "sidebar-toggle");
			return changed;
		}
		function installMobileSidebarDismiss(frame) {
			let raf = 0;
			const onClick = (event) => {
				const target = event.target;
				if (!(target instanceof Element)) return;
				if (typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 768px)").matches) return;
				const sidebar = frame.querySelector("[data-pane=\"sidebar\"]");
				const toggle = frame.querySelector("[data-dsh-responsive-part=\"sidebar-toggle\"]");
				if (!frame.hasAttribute("data-sidebar-collapsed") && sidebar !== null && !sidebar.contains(target)) {
					event.preventDefault();
					event.stopPropagation();
					toggle?.click();
					return;
				}
				if (target.closest("[data-dsh-responsive-part=\"sidebar-toggle\"]") !== null) return;
				if (target.closest("[data-dsh-part=\"sidebar-entry\"], [role=\"treeitem\"]") === null) return;
				if (raf !== 0) cancelAnimationFrame(raf);
				raf = requestAnimationFrame(() => {
					raf = 0;
					if (!frame.hasAttribute("data-sidebar-collapsed")) toggle?.click();
				});
			};
			frame.addEventListener("click", onClick, true);
			return () => {
				frame.removeEventListener("click", onClick, true);
				if (raf !== 0) cancelAnimationFrame(raf);
			};
		}
		/** One pass over the current DOM. Returns false once every stamp is already in place. */
		function applyShims() {
			let changed = false;
			for (const [selector, attribute] of COLUMN_SHIMS) {
				const el = document.querySelector(selector);
				const eq = attribute.indexOf("=");
				const name = attribute.slice(0, eq);
				const value = attribute.slice(eq + 1).replace(/^"|"$/g, "");
				if (el !== null && el.getAttribute(name) !== value) {
					el.setAttribute(name, value);
					changed = true;
				}
			}
			const frame = document.querySelector("[class*=\"sidebarCol\"]")?.parentElement ?? null;
			if (frame !== null && frame.getAttribute("data-dsh-frame") !== "") {
				frame.setAttribute("data-dsh-frame", "");
				changed = true;
			}
			if (frame !== null) changed = stampSemanticParts(frame) || changed;
			return changed;
		}
		/**
		* Coalesce mutation bursts into one pass per frame. React renders burst
		* dozens of subtree mutations per commit; stamping on every single mutation
		* callback turned each render into many querySelector sweeps. A scheduled
		* rAF plus a done flag folds the whole burst into a single pass, and the
		* idempotence check stops the work entirely once every attribute is set.
		*/
		function schedulePass() {
			if (shimScheduled) return;
			shimScheduled = true;
			requestAnimationFrame(() => {
				shimScheduled = false;
				applyShims();
				shimAfterPass?.();
			});
		}
		/** True while a coalesced pass is pending. */
		let shimScheduled = false;
		let shimAfterPass;
		/** Required services: none — the shim must run before any DOM mount waits. */
		const inject = [];
		/**
		* Resolve the shell's layout service when present, tolerating older or
		* renamed hosts. Cordis's context proxy throws "cannot get property
		* 'layout' without inject" on a direct `ctx.layout` read when 'layout' is
		* not in the plugin's `inject` list — which we deliberately keep empty so
		* the shim can apply before the shell's services come online — so we read
		* it through `ctx.get(name, false)`, the explicit non-strict store lookup
		* that bypasses the inject check. `false` also means "return undefined
		* when the providing fiber isn't active yet", which is exactly the
		* boot-time race we want to tolerate.
		*/
		function resolveLayout(ctx) {
			try {
				const viaGet = ctx.get("layout", false);
				if (viaGet !== null && typeof viaGet === "object" && "toggleSidebar" in viaGet) {
					const service = viaGet;
					if (typeof service.toggleSidebar === "function") return service;
				}
			} catch {}
		}
		/**
		* Register the shim for the page lifetime.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => {
				const responsiveStyle = ensureResponsiveStyle();
				applyShims();
				let removeMobileDismiss = () => {};
				let dismissFrame = null;
				const ensureMobileDismiss = () => {
					const frame = document.querySelector("[data-dsh-frame]");
					if (frame === null || frame === dismissFrame) return;
					removeMobileDismiss();
					removeMobileDismiss = installMobileSidebarDismiss(frame);
					dismissFrame = frame;
				};
				ensureMobileDismiss();
				shimAfterPass = ensureMobileDismiss;
				const observer = new MutationObserver(() => {
					schedulePass();
					ensureMobileDismiss();
				});
				observer.observe(document.body, {
					childList: true,
					subtree: true
				});
				const disposeSidebarMemory = installSidebarMemory(resolveLayout(ctx));
				return () => {
					observer.disconnect();
					disposeSidebarMemory();
					responsiveStyle.remove();
					removeMobileDismiss();
					shimAfterPass = void 0;
					shimScheduled = false;
				};
			});
		}
		//#endregion
		exports.RESPONSIVE_CSS = RESPONSIVE_CSS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map