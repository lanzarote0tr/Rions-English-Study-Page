(function () {
    const settingsStorageKey = "englishStudySettings";
    const localLibraryKey = "englishStudyLocalLibrary";
    const localTextPrefix = "__local__/";
    const defaultSettings = {
        darkMode: false,
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

    function loadSettings() {
        return { ...defaultSettings, ...readJson(localStorage, settingsStorageKey, {}) };
    }

    function saveSettings(settings) {
        localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
    }

    function applyTheme(settings) {
        const darkMode = Boolean(settings.darkMode);
        document.documentElement.classList.toggle("dark-mode", darkMode);
        document.body.classList.toggle("dark-mode", darkMode);
    }

    function updateDarkModeToggle(settings, id = "darkModeToggle") {
        const toggle = document.getElementById(id);
        if (toggle) {
            toggle.checked = Boolean(settings.darkMode);
        }
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
        if (mode === "fill" || mode === "line") {
            return mode;
        }
        return "practice";
    }

    window.EnglishStudy = {
        settings: {
            defaults: defaultSettings,
            load: loadSettings,
            save: saveSettings,
        },
        theme: {
            apply: applyTheme,
            updateDarkModeToggle,
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
