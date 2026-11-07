const appShell = document.querySelector(".app-shell");
const dayRail = document.querySelector("#dayRail");
const monthLabel = document.querySelector("#monthLabel");
const todayLabel = document.querySelector("#todayLabel");
const noteEditor = document.querySelector("#noteEditor");
const notePanel = document.querySelector(".note-panel");
const formatDock = document.querySelector(".format-dock");
const savedStatus = document.querySelector("#savedStatus");
const storageKey = "mon-carnet-notes-v1";
const preferenceKey = "mon-carnet-preferences-v1";
const stylePalettes = {
	minimal: { primary: "#376b56", accent: "#e37f68", background: "#f2f5ef", surface: "#fffefa", text: "#20382f" },
	cartoon: { primary: "#593bc7", accent: "#ff4f81", background: "#fff9dc", surface: "#fffefa", text: "#211b2c" },
	editorial: { primary: "#244b94", accent: "#c7493e", background: "#f8f2f0", surface: "#fffdfb", text: "#20232a" },
	brutalist: { primary: "#1558ed", accent: "#ef4b1b", background: "#eaff4d", surface: "#fffefa", text: "#111111" }
};
const notes = readNotes();
const preferences = readPreferences();
const dayNames = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
const todayFormat = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const monthFormat = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const monthNameFormat = new Intl.DateTimeFormat("fr-FR", { month: "long" });
const today = new Date();
today.setHours(12, 0, 0, 0);
let selectedDay = new Date(today);
let saveTimer;
let savedSelection = null;
let hasSelectedDay = false;
const darkSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
const contrastQuery = window.matchMedia("(prefers-contrast: more)");

function readNotes() {
	try {
		return JSON.parse(localStorage.getItem(storageKey) || "{}");
	} catch {
		return {};
	}
}

function readPreferences() {
	const defaults = { themeMode: "system", style: "minimal", stylePalettes: {} };
	try {
		const stored = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
		const themeMode = ["system", "light", "dark", "contrast"].includes(stored.themeMode)
			? stored.themeMode
			: ["light", "dark", "contrast"].includes(stored.theme) ? stored.theme : defaults.themeMode;
		const storedPalettes = stored.stylePalettes && typeof stored.stylePalettes === "object" ? stored.stylePalettes : {};
		const palettes = Object.fromEntries(Object.entries(stylePalettes).map(([style, palette]) => {
			const overrides = storedPalettes[style] && typeof storedPalettes[style] === "object" ? storedPalettes[style] : {};
			return [style, Object.fromEntries(Object.entries(palette).map(([key, color]) => [key, validCSSColor(overrides[key]) ? overrides[key] : color]))];
		}));
		const preferences = {
			themeMode,
			style: ["minimal", "cartoon", "editorial", "brutalist"].includes(stored.style) ? stored.style : defaults.style,
			stylePalettes: palettes
		};
		localStorage.setItem(preferenceKey, JSON.stringify(preferences));
		return preferences;
	} catch {
		return { ...defaults, stylePalettes: JSON.parse(JSON.stringify(stylePalettes)) };
	}
}

function validCSSColor(value) {
	return typeof value === "string" && value.length <= 64 && CSS.supports("color", value);
}

function savePreferences() {
	try {
		localStorage.setItem(preferenceKey, JSON.stringify(preferences));
	} catch {
		return;
	}
	updateStorageGauge();
}

function applyPreferences() {
	const root = document.documentElement;
	const resolvedTheme = preferences.themeMode === "system"
		? contrastQuery.matches ? "contrast" : darkSchemeQuery.matches ? "dark" : "light"
		: preferences.themeMode;
	const palette = preferences.stylePalettes[preferences.style] || stylePalettes[preferences.style];
	root.dataset.theme = resolvedTheme;
	root.dataset.style = preferences.style;
	root.style.setProperty("--custom-primary-color", palette.primary);
	root.style.setProperty("--custom-accent-color", palette.accent);
	root.style.setProperty("--custom-background-color", palette.background);
	root.style.setProperty("--custom-surface-color", palette.surface);
	root.style.setProperty("--custom-text-color", palette.text);
	document.querySelectorAll("[data-theme-choice]").forEach((option) => {
		option.setAttribute("aria-pressed", String(option.dataset.themeChoice === preferences.themeMode));
	});
	document.querySelectorAll("[data-style-choice]").forEach((option) => {
		option.setAttribute("aria-pressed", String(option.dataset.styleChoice === preferences.style));
	});
	document.querySelectorAll("[data-palette-picker]").forEach((picker) => {
		const key = picker.dataset.palettePicker;
		picker.value = colorToHex(palette[key]);
		document.querySelector(`[data-palette-value="${key}"]`).value = palette[key];
	});
	document.querySelector('meta[name="theme-color"]').content = getComputedStyle(root).getPropertyValue("--background-color").trim();
}

function colorToHex(value) {
	const probe = document.createElement("span");
	probe.style.color = value;
	document.body.append(probe);
	const computed = getComputedStyle(probe).color;
	probe.remove();
	const channels = computed.match(/[\d.]+/g)?.slice(0, 3).map(Number);
	return channels?.length === 3 ? `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}` : "#000000";
}

function setPaletteColor(key, value) {
	if (!validCSSColor(value)) return false;
	preferences.stylePalettes[preferences.style][key] = value;
	applyPreferences();
	savePreferences();
	return true;
}

function updateStorageLabel(bytes) {
	if (bytes < 1024) return `${bytes} octets`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

async function updateStorageGauge() {
	const progress = document.querySelector("#storageProgress");
	if (!progress) return;
	let used = 0;
	let quota = 5 * 1024 * 1024;
	let source = "Estimation locale";
	try {
		if (navigator.storage?.estimate) {
			const estimate = await navigator.storage.estimate();
			if (Number.isFinite(estimate.usage) && Number.isFinite(estimate.quota) && estimate.quota > 0) {
				used = estimate.usage;
				quota = estimate.quota;
				source = "Espace du navigateur";
			}
		}
		if (source === "Estimation locale") {
			used = new Blob(Object.keys(localStorage).map((key) => key + localStorage.getItem(key))).size;
			if (window.caches) {
				for (const cacheName of await caches.keys()) {
					const cache = await caches.open(cacheName);
					for (const response of await cache.matchAll()) used += (await response.clone().blob()).size;
				}
			}
		}
	} catch {
		source = "Estimation approximative";
	}
	progress.value = used > 0 ? Math.max(1, Math.min(100, Math.round((used / quota) * 100))) : 0;
	document.querySelector("#storageLabel").textContent = updateStorageLabel(used);
	document.querySelector("#storageDetail").textContent = `${updateStorageLabel(quota)} disponibles · ${source}`;
}

function closePreferenceMenus() {
	document.querySelectorAll(".preference-control").forEach((control) => {
		control.classList.remove("is-open");
		const trigger = control.querySelector(".menu-trigger");
		const menu = control.querySelector(".preference-menu");
		if (trigger) trigger.setAttribute("aria-expanded", "false");
		if (menu) {
			menu.hidden = true;
			menu.style.removeProperty("left");
			menu.style.removeProperty("top");
			menu.style.removeProperty("max-height");
		}
	});
}

function positionPreferenceMenu(button, menu) {
	const buttonRect = button.getBoundingClientRect();
	const viewport = window.visualViewport;
	const viewportWidth = viewport?.width || document.documentElement.clientWidth;
	const viewportHeight = Math.min(viewport?.height || window.innerHeight, window.innerHeight);
	const offsetLeft = viewport?.offsetLeft || 0;
	const offsetTop = viewport?.offsetTop || 0;
	const edge = 8;
	const menuRect = menu.getBoundingClientRect();
	const menuWidth = Math.min(menuRect.width, viewportWidth - edge * 2);
	const proposedLeft = menu.classList.contains("month-menu")
		? buttonRect.left + offsetLeft
		: buttonRect.right + offsetLeft - menuWidth;
	const left = Math.max(offsetLeft + edge, Math.min(proposedLeft, offsetLeft + viewportWidth - menuWidth - edge));
	const below = buttonRect.bottom + offsetTop + 7;
	const buttonTop = buttonRect.top + offsetTop;
	const bottomEdge = offsetTop + viewportHeight - edge;
	const availableBelow = Math.max(0, bottomEdge - below);
	const availableAbove = Math.max(0, buttonTop - 7 - offsetTop - edge);
	const useBelow = availableBelow >= availableAbove;
	const availableSpace = useBelow ? availableBelow : availableAbove;
	const maxHeight = Math.max(80, Math.min(440, viewportHeight - edge * 2, availableSpace));
	menu.style.maxHeight = `${maxHeight}px`;
	const measuredHeight = Math.min(menu.scrollHeight + 16, maxHeight);
	const top = useBelow ? below : Math.max(offsetTop + edge, buttonTop - measuredHeight - 7);
	menu.style.left = `${Math.round(left)}px`;
	menu.style.top = `${Math.round(top)}px`;
}

function repositionOpenPreferenceMenus() {
	document.querySelectorAll(".preference-control.is-open").forEach((control) => {
		const button = control.querySelector(".menu-trigger");
		const menu = control.querySelector(".preference-menu");
		if (button && menu && !menu.hidden) positionPreferenceMenu(button, menu);
	});
}

function togglePreferenceMenu(button, menu) {
	const shouldOpen = menu.hidden;
	closePreferenceMenus();
	if (shouldOpen) {
		menu.hidden = false;
		button.setAttribute("aria-expanded", "true");
		button.closest(".preference-control").classList.add("is-open");
		positionPreferenceMenu(button, menu);
	}
}

function populateMonthChoices() {
	const monthSelect = document.querySelector("#monthSelect");
	monthSelect.replaceChildren();
	for (let month = 0; month < 12; month += 1) {
		const option = document.createElement("option");
		option.value = String(month);
		option.textContent = monthNameFormat.format(new Date(2026, month, 1));
		monthSelect.append(option);
	}
	monthSelect.value = String(selectedDay.getMonth());
	document.querySelector("#yearSelect").value = String(selectedDay.getFullYear());
}

function applySelectedMonth() {
	const yearInput = document.querySelector("#yearSelect");
	const year = Number(yearInput.value);
	if (!Number.isInteger(year) || year < 1 || year > 9999) {
		yearInput.setCustomValidity("Saisissez une année comprise entre 1 et 9999.");
		yearInput.reportValidity();
		return;
	}
	yearInput.setCustomValidity("");
	const month = Number(document.querySelector("#monthSelect").value);
	const monthEnd = new Date(0);
	monthEnd.setFullYear(year, month + 1, 0);
	const finalDay = monthEnd.getDate();
	const nextDate = new Date(0);
	nextDate.setFullYear(year, month, Math.min(selectedDay.getDate(), finalDay));
	nextDate.setHours(12, 0, 0, 0);
	selectDay(nextDate);
	closePreferenceMenus();
}

function dateKey(date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function isSameDay(first, second) {
	return dateKey(first) === dateKey(second);
}

function renderCalendar() {
	monthLabel.textContent = monthFormat.format(selectedDay);
	dayRail.replaceChildren();

	const firstDay = new Date(selectedDay);
	firstDay.setDate(firstDay.getDate() - 21);
	for (let offset = 0; offset < 63; offset += 1) {
		const date = new Date(firstDay);
		date.setDate(firstDay.getDate() + offset);
		const key = dateKey(date);
		const button = document.createElement("button");
		button.className = "day-card";
		button.type = "button";
		button.setAttribute("aria-label", todayFormat.format(date));
		button.setAttribute("aria-pressed", String(isSameDay(date, selectedDay)));
		button.innerHTML = `<span class="day-number">${date.getDate()}</span><span class="day-name">${dayNames.format(date).replace(".", "")}</span>`;
		if (isSameDay(date, selectedDay)) button.classList.add("is-selected");
		if (isSameDay(date, today)) button.classList.add("is-today");
		if (notes[key]?.trim()) button.classList.add("has-note");
		button.addEventListener("click", () => selectDay(date));
		dayRail.append(button);
	}

	const activeCard = dayRail.querySelector(".is-selected");
	activeCard?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
}

function selectDay(date) {
	if (hasSelectedDay) {
		window.clearTimeout(saveTimer);
		saveNote();
	}
	selectedDay = new Date(date);
	selectedDay.setHours(12, 0, 0, 0);
	document.querySelector("#currentDateLabel").textContent = todayFormat.format(selectedDay);
	noteEditor.innerHTML = notes[dateKey(selectedDay)] || "";
	bindChecklistInputs();
	savedSelection = null;
	hasSelectedDay = true;
	appShell.classList.remove("is-editing");
	renderCalendar();
	noteEditor.scrollTop = 0;
}

function saveNote() {
	notes[dateKey(selectedDay)] = noteEditor.innerHTML;
	savedStatus.classList.add("is-saving");
	savedStatus.lastChild.textContent = " Enregistrement...";
	try {
		localStorage.setItem(storageKey, JSON.stringify(notes));
		savedStatus.classList.remove("is-saving");
		savedStatus.lastChild.textContent = " Enregistré";
		renderCalendar();
		updateStorageGauge();
	} catch {
		savedStatus.lastChild.textContent = " Stockage indisponible";
	}
}

function rememberSelection() {
	const selection = window.getSelection();
	if (!selection?.rangeCount || !noteEditor.contains(selection.anchorNode)) return;
	savedSelection = selection.getRangeAt(0).cloneRange();
}

function restoreSelection() {
	if (!savedSelection) {
		noteEditor.focus();
		return;
	}
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(savedSelection);
	noteEditor.focus();
}

function insertAtCursor(html) {
	restoreSelection();
	document.execCommand("insertHTML", false, html);
	bindChecklistInputs();
	rememberSelection();
	saveNote();
}

function insertChecklistItem() {
	restoreSelection();
	document.execCommand("insertHTML", false, '<span data-checkline><input type="checkbox" contenteditable="false" aria-label="Tâche terminée" />&nbsp;<span data-checktext>&nbsp;</span></span><br>');
	const textTarget = noteEditor.querySelectorAll("[data-checktext]");
	const target = textTarget[textTarget.length - 1];
	if (target) {
		const range = document.createRange();
		range.selectNodeContents(target);
		range.collapse(false);
		const selection = window.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
	}
	bindChecklistInputs();
	rememberSelection();
	saveNote();
}

function bindChecklistInputs() {
	noteEditor.querySelectorAll('input[type="checkbox"]:not([data-persist-bound])').forEach((checkbox) => {
		checkbox.dataset.persistBound = "true";
		checkbox.addEventListener("click", () => {
			window.setTimeout(() => {
				if (checkbox.checked) checkbox.setAttribute("checked", "");
				else checkbox.removeAttribute("checked");
				saveNote();
			}, 0);
		});
	});
}

dayRail.addEventListener("wheel", (event) => {
	if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
		dayRail.scrollLeft += event.deltaY;
		event.preventDefault();
	}
}, { passive: false });

document.querySelector("#monthPickerButton").addEventListener("click", (event) => {
	populateMonthChoices();
	event.stopPropagation();
	togglePreferenceMenu(event.currentTarget, document.querySelector("#monthMenu"));
});
document.querySelector("#applyMonthButton").addEventListener("click", applySelectedMonth);
document.querySelector("#goTodayButton").addEventListener("click", () => {
	selectDay(today);
	closePreferenceMenus();
});

document.querySelector("#themeButton").addEventListener("click", (event) => {
	event.stopPropagation();
	togglePreferenceMenu(event.currentTarget, document.querySelector("#themeMenu"));
});
document.querySelector("#styleButton").addEventListener("click", (event) => {
	event.stopPropagation();
	togglePreferenceMenu(event.currentTarget, document.querySelector("#styleMenu"));
});
document.querySelector("#settingsButton").addEventListener("click", (event) => {
	event.stopPropagation();
	togglePreferenceMenu(event.currentTarget, document.querySelector("#settingsMenu"));
	updateStorageGauge();
});

document.querySelectorAll("[data-theme-choice]").forEach((option) => {
	option.addEventListener("click", () => {
		preferences.themeMode = option.dataset.themeChoice;
		applyPreferences();
		savePreferences();
		closePreferenceMenus();
	});
});
document.querySelectorAll("[data-style-choice]").forEach((option) => {
	option.addEventListener("click", () => {
		preferences.style = option.dataset.styleChoice;
		applyPreferences();
		savePreferences();
		closePreferenceMenus();
	});
});
document.querySelectorAll("[data-palette-picker]").forEach((picker) => {
	picker.addEventListener("input", () => setPaletteColor(picker.dataset.palettePicker, picker.value));
});
document.querySelectorAll("[data-palette-value]").forEach((field) => {
	field.addEventListener("change", () => {
		if (setPaletteColor(field.dataset.paletteValue, field.value.trim())) {
			field.removeAttribute("aria-invalid");
		} else {
			field.setAttribute("aria-invalid", "true");
			field.focus();
		}
	});
});

noteEditor.addEventListener("input", () => {
	savedStatus.classList.add("is-saving");
	savedStatus.lastChild.textContent = " Modifications...";
	window.clearTimeout(saveTimer);
	saveTimer = window.setTimeout(saveNote, 350);
	rememberSelection();
});
noteEditor.addEventListener("keyup", rememberSelection);
noteEditor.addEventListener("mouseup", rememberSelection);

document.querySelectorAll("[data-command]").forEach((button) => {
	button.addEventListener("mousedown", (event) => event.preventDefault());
	button.addEventListener("click", () => {
		restoreSelection();
		document.execCommand(button.dataset.command, false);
		rememberSelection();
		saveNote();
		button.classList.toggle("is-active");
	});
});

document.querySelector("#checklistButton").addEventListener("mousedown", (event) => event.preventDefault());
document.querySelector("#checklistButton").addEventListener("click", insertChecklistItem);

document.addEventListener("selectionchange", rememberSelection);
noteEditor.addEventListener("focus", () => appShell.classList.add("is-editing"));
notePanel.addEventListener("pointerdown", () => appShell.classList.add("is-editing"));
noteEditor.addEventListener("blur", () => {
	window.setTimeout(() => {
		if (!formatDock.contains(document.activeElement)) appShell.classList.remove("is-editing");
	}, 0);
});
document.addEventListener("pointerdown", (event) => {
	if (!event.target.closest(".preference-control")) closePreferenceMenus();
	if (!notePanel.contains(event.target) && !formatDock.contains(event.target)) appShell.classList.remove("is-editing");
});
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") closePreferenceMenus();
});

function updateSystemTheme() {
	if (preferences.themeMode === "system") applyPreferences();
}

darkSchemeQuery.addEventListener?.("change", updateSystemTheme);
contrastQuery.addEventListener?.("change", updateSystemTheme);

function syncViewportHeight() {
	const height = Math.min(window.visualViewport?.height || window.innerHeight, window.innerHeight);
	appShell.style.setProperty("--viewport-height", `${Math.round(height)}px`);
}

window.visualViewport?.addEventListener("resize", syncViewportHeight);
window.visualViewport?.addEventListener("scroll", syncViewportHeight);
window.visualViewport?.addEventListener("resize", repositionOpenPreferenceMenus);
window.visualViewport?.addEventListener("scroll", repositionOpenPreferenceMenus);
window.addEventListener("resize", syncViewportHeight);
window.addEventListener("resize", repositionOpenPreferenceMenus);
window.addEventListener("pageshow", () => {
	if (notePanel.contains(document.activeElement)) appShell.classList.add("is-editing");
});
document.querySelector("#currentDateLabel").textContent = todayFormat.format(selectedDay);
applyPreferences();
syncViewportHeight();
selectDay(selectedDay);
updateStorageGauge();
window.setTimeout(() => {
	if (notePanel.contains(document.activeElement)) appShell.classList.add("is-editing");
}, 0);

if ("serviceWorker" in navigator && location.protocol !== "file:") {
	window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
