(function () {
    const core = window.EnglishStudy;
    const localTextPrefix = core.local.prefix;
    const loadSettings = core.settings.load;
    const saveSettings = core.settings.save;
    const loadLocalLibrary = core.local.loadLibrary;
    const saveLocalLibrary = core.local.saveLibrary;
    const normalizePath = core.path.normalize;
    const joinPath = core.path.join;
    const encodePath = core.path.encode;
    const sanitizeSegment = core.path.sanitizeSegment;
    const normalizeTextTitle = core.path.normalizeTextTitle;
    const escapeHtml = core.html.escape;
    const applyTheme = (settings) => {
        core.theme.apply(settings);
        core.theme.updateDarkModeToggle(settings);
    };
    const hasLocalNameConflict = core.local.hasNameConflict;
    const removeLocalFolder = core.local.removeFolder;

    function renderLocalItems(currentPath) {
        const list = document.querySelector(".file-list ul");
        if (!list) {
            return;
        }

        const library = loadLocalLibrary();
        const parent = normalizePath(currentPath);
        const localFolders = Object.values(library.folders)
            .filter((folder) => folder.parent_path === parent)
            .sort((a, b) => a.name.localeCompare(b.name));
        const localTexts = Object.values(library.texts)
            .filter((text) => text.parent_path === parent)
            .sort((a, b) => a.name.localeCompare(b.name));

        if (localFolders.length || localTexts.length) {
            const emptyItem = list.querySelector(".empty-folder-item");
            if (emptyItem) {
                emptyItem.remove();
            }
        }

        const folderHtml = localFolders.map((folder) => `
            <li class="local-item">
                <div class="folder-item-container">
                    <a class="item-link folder-item" href="/select/${encodePath(folder.path)}">
                        <span>📁</span> ${escapeHtml(folder.name)}
                    </a>
                    <button type="button" class="delete-local-button" data-local-delete="folder" data-local-path="${escapeHtml(folder.path)}">삭제</button>
                </div>
            </li>
        `).join("");

        const textHtml = localTexts.map((text) => `
            <li class="local-item">
                <div class="file-item-container local-file-item">
                    <div class="file-title">${escapeHtml(text.name)}</div>
                    <div class="file-actions">
                        <a class="action-button study-button" href="/study/${localTextPrefix}${encodePath(text.path)}">
                            <span>📚</span> 공부
                        </a>
                        <button type="button" class="delete-local-button" data-local-delete="text" data-local-path="${escapeHtml(text.path)}">삭제</button>
                    </div>
                </div>
            </li>
        `).join("");

        list.insertAdjacentHTML("beforeend", `${folderHtml}${textHtml}`);
    }

    window.EnglishStudyPages = window.EnglishStudyPages || {};
    window.EnglishStudyPages.select = {
        init() {
            if (document.body.dataset.page !== "select") {
                return () => {};
            }

            const settings = loadSettings();
            const darkModeToggle = document.getElementById("darkModeToggle");
            const profilePic = document.getElementById("profilePic");
            const profileInfo = document.getElementById("profileInfo");
            const pageRoot = document.getElementById("page-root");
            const createFolderForm = document.getElementById("createFolderForm");
            const createTextForm = document.getElementById("createTextForm");
            const createStatus = document.getElementById("createStatus");
            const uploadPanel = document.getElementById("uploadPanel");
            const uploadToggle = uploadPanel ? uploadPanel.querySelector(".upload-toggle") : null;
            const openFormatGuide = document.getElementById("openFormatGuide");
            const closeFormatGuide = document.getElementById("closeFormatGuide");
            const formatGuideModal = document.getElementById("formatGuideModal");
            const currentPath = normalizePath(pageRoot ? pageRoot.dataset.currentPath || "" : "");
            let uploadCloseTimer = 0;

            applyTheme(settings);
            renderLocalItems(currentPath);

            function toggleProfile(event) {
                event.stopPropagation();
                profileInfo.classList.toggle("show");
            }

            function closeProfile(event) {
                if (!profileInfo.contains(event.target) && !profilePic.contains(event.target)) {
                    profileInfo.classList.remove("show");
                }
            }

            function handleDarkModeChange() {
                settings.darkMode = darkModeToggle.checked;
                saveSettings(settings);
                applyTheme(settings);
            }

            function setCreateStatus(message, tone = "") {
                if (!createStatus) {
                    return;
                }
                createStatus.textContent = message;
                createStatus.dataset.tone = tone;
            }

            function refreshCurrentFolder() {
                const selectUrl = `/select/${encodePath(currentPath)}`;
                if (window.EnglishStudyNavigation && typeof window.EnglishStudyNavigation.visit === "function") {
                    window.EnglishStudyNavigation.visit(selectUrl, { history: "none" });
                    return;
                }
                window.location.href = selectUrl;
            }

            function openUploadPanel() {
                if (!uploadPanel) {
                    return;
                }
                window.clearTimeout(uploadCloseTimer);
                uploadPanel.open = true;
                if (uploadToggle) {
                    uploadToggle.setAttribute("aria-expanded", "true");
                }
                uploadPanel.classList.remove("is-closing");
                requestAnimationFrame(() => {
                    uploadPanel.classList.add("is-open");
                });
            }

            function closeUploadPanel() {
                if (!uploadPanel) {
                    return;
                }
                window.clearTimeout(uploadCloseTimer);
                uploadPanel.classList.remove("is-open");
                uploadPanel.classList.add("is-closing");
                uploadCloseTimer = window.setTimeout(() => {
                    uploadPanel.open = false;
                    uploadPanel.classList.remove("is-closing");
                    if (uploadToggle) {
                        uploadToggle.setAttribute("aria-expanded", "false");
                    }
                }, 260);
            }

            function handleUploadToggle(event) {
                if (!uploadPanel) {
                    return;
                }
                event.preventDefault();
                if (uploadPanel.open && uploadPanel.classList.contains("is-open")) {
                    closeUploadPanel();
                } else {
                    openUploadPanel();
                }
            }

            function handleCreateFolder(event) {
                event.preventDefault();
                try {
                    const formData = new FormData(createFolderForm);
                    const name = sanitizeSegment(formData.get("name"), "폴더 이름");
                    const library = loadLocalLibrary();
                    if (hasLocalNameConflict(library, currentPath, name)) {
                        throw new Error("같은 이름의 개인 폴더나 텍스트가 이미 있습니다.");
                    }

                    const path = joinPath(currentPath, name);
                    library.folders[path] = {
                        name,
                        path,
                        parent_path: currentPath,
                        created_at: Date.now(),
                    };
                    saveLocalLibrary(library);
                    createFolderForm.reset();
                    setCreateStatus("이 브라우저에 폴더를 만들었습니다.", "success");
                    refreshCurrentFolder();
                } catch (error) {
                    setCreateStatus(error.message, "error");
                }
            }

            function handleCreateText(event) {
                event.preventDefault();
                try {
                    const formData = new FormData(createTextForm);
                    const name = normalizeTextTitle(formData.get("title"));
                    const content = String(formData.get("content") || "").trim();
                    if (!content) {
                        throw new Error("텍스트 내용을 입력하세요.");
                    }

                    const library = loadLocalLibrary();
                    if (hasLocalNameConflict(library, currentPath, name)) {
                        throw new Error("같은 이름의 개인 폴더나 텍스트가 이미 있습니다.");
                    }

                    const path = joinPath(currentPath, `${name}.txt`);
                    library.texts[path] = {
                        name,
                        path,
                        parent_path: currentPath,
                        content,
                        created_at: Date.now(),
                        updated_at: Date.now(),
                    };
                    saveLocalLibrary(library);
                    createTextForm.reset();
                    setCreateStatus("이 브라우저에 텍스트를 만들었습니다.", "success");
                    refreshCurrentFolder();
                } catch (error) {
                    setCreateStatus(error.message, "error");
                }
            }

            function handleDeleteLocalItem(event) {
                const button = event.target.closest("[data-local-delete]");
                if (!button) {
                    return;
                }

                event.preventDefault();
                const type = button.dataset.localDelete;
                const path = normalizePath(button.dataset.localPath || "");
                const library = loadLocalLibrary();
                if (type === "folder") {
                    if (!window.confirm("이 개인 폴더와 안의 개인 텍스트를 삭제할까요?")) {
                        return;
                    }
                    removeLocalFolder(library, path);
                    setCreateStatus("개인 폴더를 삭제했습니다.", "success");
                } else if (type === "text") {
                    if (!window.confirm("이 개인 텍스트를 삭제할까요?")) {
                        return;
                    }
                    delete library.texts[path];
                    setCreateStatus("개인 텍스트를 삭제했습니다.", "success");
                }
                saveLocalLibrary(library);
                refreshCurrentFolder();
            }

            function showFormatGuide() {
                if (!formatGuideModal) {
                    return;
                }
                formatGuideModal.classList.add("show");
                formatGuideModal.setAttribute("aria-hidden", "false");
                if (closeFormatGuide) {
                    closeFormatGuide.focus();
                }
            }

            function hideFormatGuide() {
                if (!formatGuideModal) {
                    return;
                }
                formatGuideModal.classList.remove("show");
                formatGuideModal.setAttribute("aria-hidden", "true");
            }

            function handleGuideBackdropClick(event) {
                if (event.target === formatGuideModal) {
                    hideFormatGuide();
                }
            }

            function handleGuideKeydown(event) {
                if (event.key === "Escape" && formatGuideModal && formatGuideModal.classList.contains("show")) {
                    hideFormatGuide();
                }
            }

            if (darkModeToggle) {
                darkModeToggle.addEventListener("change", handleDarkModeChange);
            }
            if (profilePic && profileInfo) {
                profilePic.addEventListener("click", toggleProfile);
                document.addEventListener("click", closeProfile);
            }
            if (createFolderForm) {
                createFolderForm.addEventListener("submit", handleCreateFolder);
            }
            if (createTextForm) {
                createTextForm.addEventListener("submit", handleCreateText);
            }
            if (uploadToggle) {
                uploadToggle.addEventListener("click", handleUploadToggle);
            }
            if (openFormatGuide) {
                openFormatGuide.addEventListener("click", showFormatGuide);
            }
            if (closeFormatGuide) {
                closeFormatGuide.addEventListener("click", hideFormatGuide);
            }
            if (formatGuideModal) {
                formatGuideModal.addEventListener("click", handleGuideBackdropClick);
            }
            document.addEventListener("keydown", handleGuideKeydown);
            document.addEventListener("click", handleDeleteLocalItem);

            return () => {
                if (darkModeToggle) {
                    darkModeToggle.removeEventListener("change", handleDarkModeChange);
                }
                if (profilePic && profileInfo) {
                    profilePic.removeEventListener("click", toggleProfile);
                    document.removeEventListener("click", closeProfile);
                }
                if (createFolderForm) {
                    createFolderForm.removeEventListener("submit", handleCreateFolder);
                }
                if (createTextForm) {
                    createTextForm.removeEventListener("submit", handleCreateText);
                }
                if (uploadToggle) {
                    uploadToggle.removeEventListener("click", handleUploadToggle);
                }
                window.clearTimeout(uploadCloseTimer);
                if (openFormatGuide) {
                    openFormatGuide.removeEventListener("click", showFormatGuide);
                }
                if (closeFormatGuide) {
                    closeFormatGuide.removeEventListener("click", hideFormatGuide);
                }
                if (formatGuideModal) {
                    formatGuideModal.removeEventListener("click", handleGuideBackdropClick);
                }
                document.removeEventListener("keydown", handleGuideKeydown);
                document.removeEventListener("click", handleDeleteLocalItem);
            };
        },
    };
}());
