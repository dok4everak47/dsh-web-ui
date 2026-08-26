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
		* React store (see the ui-layout panel store: `init` always boots the
		* sidebar open); it is never written to a store, localStorage, or settings,
		* so every fresh page load starts the column expanded. This module persists
		* the last user-chosen fold state in localStorage and restores it as soon as
		* the sidebar column mounts.
		*
		* Safety-first design (this runs on every page, including while the user
		* types, so it must not fight the shell or cause layout feedback):
		*
		*  - No MutationObserver: previous drafts observed the sidebar's class/style
		*    attributes, but React re-renders during typing can fire those observers
		*    and the resulting width-read / localStorage-write loop could interact
		*    badly with the shell's focus management. We now persist only at
		*    natural pause points: pagehide, visibilitychange to hidden, and a slow
		*    5-second heartbeat. None of these run per keystroke.
		*  - Width-based state detection: offsetWidth < 120px classifies the 56px
		*    rail; anything wider is expanded. We never read hashed css-module
		*    class names, so the detection survives shell rc upgrades.
		*  - Restore is instant and animation-free: a 16ms watcher loop starts at
		*    install and flips the state through ctx.layout.toggleSidebar() on the
		*    first tick after the sidebar mounts (one frame at most is painted in
		*    the boot default). The shell's frame grid animates
		*    `grid-template-columns` on every toggle, and the sidebar's inner
		*    content runs additional collapse animations (header actions fade, the
		*    search box narrows) in a LATER React render than the frame grid, so a
		*    one-shot frame tag is not enough. The restore sets a `data-dsh-sidebar-boot`
		*    attribute on <html> that disables transitions across the whole sidebar
		*    subtree until the first user interaction (pointer / key / wheel /
		*    touch) or a 4s cap, covering every delayed inner render; once the user
		*    acts the attribute is removed and manual toggles animate normally.
		*    There is NO synthetic button click fallback: a programmatic click on
		*    the shell's toggle button could scroll the button into view and steal
		*    focus from the composer.
		*  - When the layout service is absent, restore is skipped and the shell
		*    default stands.
		*  - Kill switch: setting localStorage `dsh:sidebar-memory` to `"off"`
		*    before load disables the feature entirely (refresh to apply).
		*
		* Every external access is defensive: a missing sidebar, a storage that
		* throws in private mode, a layout service that disappears mid-run, and a
		* sidebar that never mounts all degrade to a no-op.
		* @module dsh-web-all/client/sidebar-memory
		*/
		/** localStorage key under which the last collapsed flag is stored. */
		const STORAGE_KEY = "dsh:sidebar-collapsed";
		/** Kill switch: when set to "off" the controller never installs. */
		const DISABLE_KEY = "dsh:sidebar-memory";
		/**
		* Widths below this threshold are treated as the collapsed rail. The shell's
		* rail is 56px (plus ~20px inline padding baked into the root) and its
		* expanded column is user-resizable starting around 240px; a midpoint
		* threshold gives a wide margin against future tweaks.
		*/
		const COLLAPSED_WIDTH_THRESHOLD = 120;
		/** Watcher tick: find the mounted sidebar at frame granularity. */
		const TICK_MS = 16;
		/** Give up restoring when the sidebar has not mounted after this long. */
		const RESTORE_WATCH_MS = 1e4;
		/**
		* Hard cap for the interaction-gated suppression: even if no user input ever
		* arrives, stop suppressing after this long so the shell's own animations
		* cannot stay disabled on an idle page.
		*/
		const BOOT_SUPPRESS_MS = 4e3;
		/** Attribute on <html> that keeps sidebar transitions suppressed until first interaction. */
		const BOOT_ATTR = "data-dsh-sidebar-boot";
		/** Attribute identifying the suppression stylesheet owned by this module. */
		const STYLE_ATTR = "data-dsh-sidebar-memory";
		/**
		* Transition suppression for the sidebar restore. The frame grid animates
		* `grid-template-columns`, its children include the resize handle that
		* animates `left`, and the sidebar's INNER content runs its own collapse
		* animations when the rail state flips (header actions animate
		* max-width/opacity/transform, the search box animates width/padding, and so
		* on) — and those inner commits land in a later React render than the frame
		* grid, so a one-shot tag removed as soon as the outer width matched still
		* let the ~0.18s content collapse play through and read as the old close
		* animation.
		*
		* The rule therefore keys off an attribute on <html> that stays set from the
		* restore toggle until the first user interaction (pointer / key / wheel /
		* touch) or the BOOT_SUPPRESS_MS cap, covering every delayed inner render.
		* `transition: none` on every descendant of the sidebar frame kills the lot.
		* This is deliberately broad but only active before the user does anything;
		* once they interact it is removed and manual toggles animate normally. It
		* mirrors how the shell itself disables the frame transition while dragging
		* (`[data-dragging] { transition: none }`).
		*/
		const SUPPRESS_CSS = `
html[${BOOT_ATTR}] [data-pane="sidebar"],
html[${BOOT_ATTR}] [data-pane="sidebar"] *,
html[${BOOT_ATTR}] [class*="sidebarCol"],
html[${BOOT_ATTR}] [class*="sidebarCol"] *,
html[${BOOT_ATTR}] [class*="sidebarCol"] ~ [class*="handle"] {
  transition: none !important;
}`;
		/** Heartbeat: if the page stays open for a long time without unloading,
		*  still persist the current state occasionally (cheap: one width read +
		*  one localStorage write). */
		const HEARTBEAT_MS = 5e3;
		/** Read the persisted collapsed flag; null when never stored or storage fails. */
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
		/** Persist the collapsed flag. Silent on storage failure (private mode, quota). */
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
		/** Find the shell sidebar column once the compat shim has stamped it. */
		function findSidebar() {
			return document.querySelector("[data-pane=\"sidebar\"], [class*=\"sidebarCol\"]");
		}
		/**
		* Classify a sidebar element as collapsed by its measured width. A zero-width
		* element (detached, display:none during a transition) returns undefined so
		* the caller can skip persisting a false reading rather than treat it as
		* expanded.
		*/
		function isCollapsedByWidth(sidebar) {
			const width = sidebar.offsetWidth;
			if (width <= 0) return void 0;
			return width < COLLAPSED_WIDTH_THRESHOLD;
		}
		/**
		* Install the sidebar memory controller. Idempotent: a second call before
		* the previous instance is disposed returns the previous disposer and does
		* not stack listeners.
		* @param layout - the cordis layout service when reachable; undefined when
		*   the host shell does not expose one, in which case restore is skipped.
		* @returns disposer that stops all listeners and timers.
		*/
		function installSidebarMemory(layout) {
			if (installAnchor !== void 0) return installAnchor;
			if (isDisabled()) return () => {};
			let disposed = false;
			let sidebar = null;
			let restored = false;
			let watchTimer;
			let bootCapTimer;
			let heartbeatTimer;
			let lastPersisted = readPersisted();
			let toggleFailed = false;
			let bootSuppressing = false;
			let suppressStyle = null;
			const stopTimers = () => {
				if (watchTimer !== void 0) {
					clearTimeout(watchTimer);
					watchTimer = void 0;
				}
				if (bootCapTimer !== void 0) {
					clearTimeout(bootCapTimer);
					bootCapTimer = void 0;
				}
			};
			/**
			* First-interaction release: the boot suppression exists only to hide the
			* restore collapse on a fresh load. Once the user points, types, scrolls,
			* or touches, normal transitions must return so manual toggles animate.
			* Deferred a task so the very event that releases suppression does not see
			* a mid-dispatch style change.
			*/
			function releaseSuppression() {
				setTimeout(removeSuppression, 0);
			}
			/** End the boot transition suppression (safe to call repeatedly). */
			const removeSuppression = () => {
				if (!bootSuppressing) return;
				bootSuppressing = false;
				if (bootCapTimer !== void 0) {
					clearTimeout(bootCapTimer);
					bootCapTimer = void 0;
				}
				const opts = { capture: true };
				window.removeEventListener("pointerdown", releaseSuppression, opts);
				window.removeEventListener("keydown", releaseSuppression, opts);
				window.removeEventListener("wheel", releaseSuppression, opts);
				window.removeEventListener("touchstart", releaseSuppression, opts);
				document.documentElement.removeAttribute(BOOT_ATTR);
			};
			const cleanup = () => {
				disposed = true;
				stopTimers();
				removeSuppression();
				if (heartbeatTimer !== void 0) clearInterval(heartbeatTimer);
				window.removeEventListener("pagehide", persistNow);
				document.removeEventListener("visibilitychange", onVisibilityChange);
				if (suppressStyle !== null) {
					suppressStyle.remove();
					suppressStyle = null;
				}
				sidebar = null;
				installAnchor = void 0;
			};
			installAnchor = cleanup;
			/** Read the current width and write it to localStorage if it changed. */
			const persistNow = () => {
				if (disposed) return;
				const current = sidebar !== null ? isCollapsedByWidth(sidebar) : void 0;
				if (current === void 0) return;
				if (lastPersisted !== current) {
					lastPersisted = current;
					writePersisted(current);
				}
			};
			/** Save when the tab is hidden (refresh, navigation, tab switch). */
			const onVisibilityChange = () => {
				if (document.visibilityState === "hidden") persistNow();
			};
			/**
			* Restore the persisted state now that the sidebar has mounted with a
			* readable width. Runs exactly once; never retries because a retry loop
			* during ongoing React re-renders is what we are deliberately avoiding.
			*/
			const restore = () => {
				if (sidebar === null) return;
				restored = true;
				const current = isCollapsedByWidth(sidebar);
				if (current === void 0) return;
				if (lastPersisted === null) {
					lastPersisted = current;
					writePersisted(current);
					return;
				}
				if (lastPersisted === current) return;
				if (layout === void 0 || toggleFailed) return;
				bootSuppressing = true;
				document.documentElement.setAttribute(BOOT_ATTR, "");
				const cap = { capture: true };
				const passive = {
					capture: true,
					passive: true
				};
				window.addEventListener("pointerdown", releaseSuppression, passive);
				window.addEventListener("keydown", releaseSuppression, cap);
				window.addEventListener("wheel", releaseSuppression, passive);
				window.addEventListener("touchstart", releaseSuppression, passive);
				bootCapTimer = setTimeout(removeSuppression, BOOT_SUPPRESS_MS);
				try {
					layout.toggleSidebar();
				} catch {
					removeSuppression();
					toggleFailed = true;
					return;
				}
				lastPersisted = !current;
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
					if (budgetLeft <= TICK_MS) return;
					watchForSidebar(budgetLeft - TICK_MS);
				}, TICK_MS);
			};
			const style = document.createElement("style");
			style.setAttribute(STYLE_ATTR, "");
			style.textContent = SUPPRESS_CSS;
			document.head.appendChild(style);
			suppressStyle = style;
			watchForSidebar(RESTORE_WATCH_MS);
			window.addEventListener("pagehide", persistNow, { passive: true });
			document.addEventListener("visibilitychange", onVisibilityChange, { passive: true });
			heartbeatTimer = setInterval(persistNow, HEARTBEAT_MS);
			return cleanup;
		}
		/** Singleton anchor: guards against double-install from HMR / re-apply. */
		let installAnchor;
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