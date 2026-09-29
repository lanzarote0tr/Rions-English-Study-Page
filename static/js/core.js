(function () {
    const settingsStorageKey = "englishStudySettings";
    const localLibraryKey = "englishStudyLocalLibrary";
    const localTextPrefix = "__local__/";
    const themes = [
        { id: "light", label: "라이트" },
        { id: "dark", label: "다크" },
    ];
    const themeIds = new Set(themes.map((theme) => theme.id));
    const defaultSettings = {
        theme: "light",
        practiceReveal: true,
        practiceWordHint: false,
        fillPreview: false,
        fillFirstLetter: false,
    };

    function readJson(storage, key, fallback) {
        try {
            return JSON.parse(storage.getItem(key) || JSON.stringify(fallback));
        } catch (error) {
            return fallback;
        }
    }

    function resolveTheme(saved) {
        if (themeIds.has(saved.theme)) {
            return saved.theme;
        }
        // Settings saved before themes existed only stored a dark-mode flag.
        return saved.darkMode ? "dark" : defaultSettings.theme;
    }

    function loadSettings() {
        const stored = readJson(localStorage, settingsStorageKey, {});
        const saved = stored && typeof stored === "object" ? stored : {};
        const settings = { ...defaultSettings, ...saved, theme: resolveTheme(saved) };
        delete settings.darkMode;
        return settings;
    }

    function saveSettings(settings) {
        localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
    }

    function applyTheme(settings) {
        document.documentElement.dataset.theme = resolveTheme(settings);
    }

    function createThemePicker(options) {
        const { container, settings, onChange, onClose } = options;
        const dialog = document.createElement("dialog");
        dialog.className = "dialog theme-dialog";
        dialog.setAttribute("aria-label", "테마");
        dialog.innerHTML = `
            <div class="dialog-header">
                <h2>테마</h2>
                <button type="button" class="btn btn-sm" data-theme-close>닫기</button>
            </div>
            <div class="dialog-body">
                <div class="theme-grid" role="radiogroup" aria-label="테마 선택">
                    ${themes.map((theme) => `
                        <label class="theme-option">
                            <input type="radio" name="studyTheme" value="${theme.id}">
                            <span class="theme-preview" data-theme="${theme.id}" aria-hidden="true">
                                <span class="theme-preview-bar"></span>
                                <span class="theme-preview-line"></span>
                                <span class="theme-preview-line theme-preview-line-short"></span>
                                <span class="theme-preview-accent"></span>
                            </span>
                            <span class="theme-option-label">${escapeHtml(theme.label)}</span>
                        </label>
                    `).join("")}
                </div>
            </div>
        `;
        container.appendChild(dialog);

        const closeButton = dialog.querySelector("[data-theme-close]");
        const radios = [...dialog.querySelectorAll("input[name='studyTheme']")];

        function syncSelection() {
            const current = resolveTheme(settings);
            radios.forEach((radio) => {
                radio.checked = radio.value === current;
            });
        }

        function close() {
            if (dialog.open) {
                dialog.close();
            }
        }

        function open() {
            syncSelection();
            if (!dialog.open) {
                dialog.showModal();
            }
            const selected = radios.find((radio) => radio.checked) || radios[0];
            window.requestAnimationFrame(() => {
                if (dialog.open) {
                    selected.focus();
                }
            });
        }

        function handleChange(event) {
            const radio = event.target;
            if (!radio.checked || !themeIds.has(radio.value)) {
                return;
            }
            settings.theme = radio.value;
            saveSettings(settings);
            applyTheme(settings);
            if (typeof onChange === "function") {
                onChange(settings.theme);
            }
        }

        function handleBackdropClick(event) {
            if (event.target !== dialog) {
                return;
            }
            const rect = dialog.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right
                || event.clientY < rect.top || event.clientY > rect.bottom) {
                close();
            }
        }

        function handleClose() {
            if (typeof onClose === "function") {
                onClose();
            }
        }

        dialog.addEventListener("change", handleChange);
        dialog.addEventListener("click", handleBackdropClick);
        dialog.addEventListener("close", handleClose);
        closeButton.addEventListener("click", close);

        return {
            element: dialog,
            open,
            close,
            isOpen: () => dialog.open,
            destroy() {
                dialog.removeEventListener("change", handleChange);
                dialog.removeEventListener("click", handleBackdropClick);
                dialog.removeEventListener("close", handleClose);
                closeButton.removeEventListener("click", close);
                close();
                dialog.remove();
            },
        };
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        }[char]));
    }

    function normalizePath(path) {
        return String(path || "").split("/").filter(Boolean).join("/");
    }

    function joinPath(parent, name) {
        return normalizePath([normalizePath(parent), name].filter(Boolean).join("/"));
    }

    function encodePath(path) {
        return normalizePath(path).split("/").map(encodeURIComponent).join("/");
    }

    function sanitizeSegment(value, label) {
        const name = String(value || "").trim();
        if (!name) {
            throw new Error(`${label}을 입력하세요.`);
        }
        if (name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0") || name.startsWith(".")) {
            throw new Error(`${label}에 사용할 수 없는 문자가 있습니다.`);
        }
        if (name.length > 120) {
            throw new Error(`${label}이 너무 깁니다.`);
        }
        return name;
    }

    function normalizeTextTitle(value) {
        const title = sanitizeSegment(value, "텍스트 제목");
        if (title.toLowerCase().endsWith(".txt")) {
            return title.slice(0, -4).trim();
        }
        return title;
    }

    function containsHangul(text) {
        return /[가-힣]/.test(text);
    }

    function parseLocalTextContent(rawText) {
        const normalized = String(rawText || "").replace(/\ufeff/g, "").trim();
        const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (lines.length >= 2 && lines.length % 2 === 0) {
            const englishLines = lines.filter((_, index) => index % 2 === 0);
            const koreanLines = lines.filter((_, index) => index % 2 === 1);
            const alternating = englishLines.every((line) => !containsHangul(line))
                && koreanLines.every((line) => containsHangul(line));
            if (alternating) {
                return {
                    english_content: englishLines.join("\n"),
                    korean_content: koreanLines.join("\n"),
                    line_pairs: englishLines.map((english, index) => ({
                        english,
                        korean: koreanLines[index] || "",
                    })),
                };
            }
        }

        return {
            english_content: lines.join("\n"),
            korean_content: "",
            line_pairs: [],
        };
    }

    function normalizeLocalLibrary(saved) {
        return {
            folders: saved.folders && typeof saved.folders === "object" ? saved.folders : {},
            texts: saved.texts && typeof saved.texts === "object" ? saved.texts : {},
        };
    }

    function loadLocalLibrary() {
        return normalizeLocalLibrary(readJson(localStorage, localLibraryKey, {}));
    }

    function saveLocalLibrary(library) {
        localStorage.setItem(localLibraryKey, JSON.stringify(normalizeLocalLibrary(library)));
    }

    function getLocalText(path) {
        return loadLocalLibrary().texts[normalizePath(path)] || null;
    }

    function hasLocalNameConflict(library, parentPath, name) {
        const parent = normalizePath(parentPath);
        return Object.values(library.folders).some((folder) => folder.parent_path === parent && folder.name === name)
            || Object.values(library.texts).some((text) => text.parent_path === parent && text.name === name);
    }

    function removeLocalFolder(library, folderPath) {
        const target = normalizePath(folderPath);
        Object.keys(library.folders).forEach((path) => {
            if (path === target || path.startsWith(`${target}/`)) {
                delete library.folders[path];
            }
        });
        Object.keys(library.texts).forEach((path) => {
            if (path.startsWith(`${target}/`)) {
                delete library.texts[path];
            }
        });
    }

    function normalizeStudyMode(mode) {
        if (mode === "notes" || mode === "practice" || mode === "fill" || mode === "line") {
            return mode;
        }
        return "notes";
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    function motionDuration(property) {
        if (reducedMotion.matches) {
            return 0;
        }
        const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
        return (parseFloat(value) || 0) * (value.endsWith("ms") ? 1 : 1000);
    }

    function positionModeIndicator(button) {
        const tabs = button && button.closest(".study-mode-tabs");
        if (!tabs) {
            return;
        }
        tabs.style.setProperty("--mode-x", `${button.offsetLeft}px`);
        tabs.style.setProperty("--mode-y", `${button.offsetTop}px`);
        tabs.style.setProperty("--mode-width", `${button.offsetWidth}px`);
        tabs.style.setProperty("--mode-height", `${button.offsetHeight}px`);
        tabs.classList.add("has-mode-indicator");
    }

    function createConfirmDialog(options) {
        const {
            container,
            title,
            description,
            confirmLabel = "확인",
            cancelLabel = "취소",
            onConfirm,
            onClose,
        } = options;
        const dialog = document.createElement("dialog");
        dialog.className = "dialog";
        dialog.setAttribute("aria-label", title);

        const header = document.createElement("div");
        header.className = "dialog-header";
        const heading = document.createElement("h2");
        heading.textContent = title;
        header.appendChild(heading);

        const body = document.createElement("div");
        body.className = "dialog-body";

        if (description) {
            const text = document.createElement("p");
            text.textContent = description;
            body.appendChild(text);
        }

        const actions = document.createElement("div");
        actions.className = "dialog-actions";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "btn";
        cancelButton.textContent = cancelLabel;

        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.className = "btn btn-danger";
        confirmButton.textContent = confirmLabel;

        actions.appendChild(cancelButton);
        actions.appendChild(confirmButton);
        body.appendChild(actions);
        dialog.appendChild(header);
        dialog.appendChild(body);
        container.appendChild(dialog);

        function close() {
            if (dialog.open) {
                dialog.close();
            }
        }

        function open() {
            if (!dialog.open) {
                dialog.showModal();
            }
            window.requestAnimationFrame(() => {
                if (dialog.open) {
                    cancelButton.focus();
                }
            });
        }

        function handleConfirm() {
            close();
            if (typeof onConfirm === "function") {
                onConfirm();
            }
        }

        function handleClose() {
            if (typeof onClose === "function") {
                onClose();
            }
        }

        cancelButton.addEventListener("click", close);
        confirmButton.addEventListener("click", handleConfirm);
        dialog.addEventListener("close", handleClose);

        return {
            element: dialog,
            open,
            close,
            isOpen: () => dialog.open,
            destroy() {
                cancelButton.removeEventListener("click", close);
                confirmButton.removeEventListener("click", handleConfirm);
                dialog.removeEventListener("close", handleClose);
                close();
                dialog.remove();
            },
        };
    }

    window.EnglishStudy = {
        motion: {
            reduced: () => reducedMotion.matches,
            duration: motionDuration,
            positionModeIndicator,
        },
        dialog: {
            confirm: createConfirmDialog,
        },
        settings: {
            defaults: defaultSettings,
            load: loadSettings,
            save: saveSettings,
        },
        theme: {
            apply: applyTheme,
            createPicker: createThemePicker,
        },
        html: {
            escape: escapeHtml,
        },
        path: {
            normalize: normalizePath,
            join: joinPath,
            encode: encodePath,
            sanitizeSegment,
            normalizeTextTitle,
        },
        local: {
            prefix: localTextPrefix,
            loadLibrary: loadLocalLibrary,
            saveLibrary: saveLocalLibrary,
            getText: getLocalText,
            hasNameConflict: hasLocalNameConflict,
            removeFolder: removeLocalFolder,
            parseTextContent: parseLocalTextContent,
        },
        text: {
            containsHangul,
            normalizeStudyMode,
        },
    };

    window.EnglishStudyLocal = {
        prefix: localTextPrefix,
        loadLibrary: loadLocalLibrary,
        getText: getLocalText,
    };
}());
