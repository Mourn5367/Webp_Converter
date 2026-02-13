import { FFmpeg } from "./assets/ffmpeg/ffmpeg/index.js";
import { fetchFile, toBlobURL } from "./assets/ffmpeg/util/index.js";

const els = {
  fileInput: document.querySelector("#fileInput"),
  dropzone: document.querySelector("#dropzone"),
  sizeWarning: document.querySelector("#sizeWarning"),
  metaName: document.querySelector("#metaName"),
  metaSize: document.querySelector("#metaSize"),
  metaResolution: document.querySelector("#metaResolution"),
  metaDuration: document.querySelector("#metaDuration"),
  sourceStage: document.querySelector("#sourceStage"),
  sourcePreview: document.querySelector("#sourcePreview"),
  cropOverlay: document.querySelector("#cropOverlay"),
  cropBox: document.querySelector("#cropBox"),
  playheadLabel: document.querySelector("#playheadLabel"),
  trimStartRange: document.querySelector("#trimStartRange"),
  trimEndRange: document.querySelector("#trimEndRange"),
  cropToggleBtn: document.querySelector("#cropToggleBtn"),
  setStartBtn: document.querySelector("#setStartBtn"),
  setEndBtn: document.querySelector("#setEndBtn"),
  quickPreviewBtn: document.querySelector("#quickPreviewBtn"),
  trimStart: document.querySelector("#trimStart"),
  trimEnd: document.querySelector("#trimEnd"),
  cropX: document.querySelector("#cropX"),
  cropY: document.querySelector("#cropY"),
  cropW: document.querySelector("#cropW"),
  cropH: document.querySelector("#cropH"),
  resizeW: document.querySelector("#resizeW"),
  resizeH: document.querySelector("#resizeH"),
  fpsRange: document.querySelector("#fpsRange"),
  fpsInput: document.querySelector("#fpsInput"),
  speedRange: document.querySelector("#speedRange"),
  speedInput: document.querySelector("#speedInput"),
  qualityRange: document.querySelector("#qualityRange"),
  qualityInput: document.querySelector("#qualityInput"),
  targetSizeMB: document.querySelector("#targetSizeMB"),
  recommendBtn: document.querySelector("#recommendBtn"),
  editorTabButtons: document.querySelectorAll(".editor-tab-btn"),
  editorTabPanels: document.querySelectorAll(".editor-tab-panel"),
  cropResetBtn: document.querySelector("#cropResetBtn"),
  resizeResetBtn: document.querySelector("#resizeResetBtn"),
  estimateBtn: document.querySelector("#estimateBtn"),
  convertBtn: document.querySelector("#convertBtn"),
  cancelBtn: document.querySelector("#cancelBtn"),
  statusText: document.querySelector("#statusText"),
  subStatusText: document.querySelector("#subStatusText"),
  progressBar: document.querySelector("#progressBar"),
  outputSize: document.querySelector("#outputSize"),
  sizeDelta: document.querySelector("#sizeDelta"),
  estimateSize: document.querySelector("#estimateSize"),
  downloadLink: document.querySelector("#downloadLink"),
  resultPreview: document.querySelector("#resultPreview"),
  logOutput: document.querySelector("#logOutput"),
};

const state = {
  ffmpeg: null,
  ffmpegReady: false,
  isProcessing: false,
  isCancelled: false,
  currentFile: null,
  sourceURL: null,
  resultURL: null,
  metadata: null,
  logLines: [],
  cropDrag: null,
  cropEditEnabled: false,
  probeSeq: 0,
};

const MAX_RECOMMENDED_BYTES = 200 * 1024 * 1024;
const LOG_LIMIT = 120;
const MIN_TRIM_GAP = 0.1;
const MIN_CROP_SIZE = 8;
const FFMPEG_CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
const FFMPEG_LOCAL_CORE_BASE = "./assets/ffmpeg";

init();

function init() {
  linkSliderAndInput(els.fpsRange, els.fpsInput, 1, 60);
  linkSliderAndDecimalInput(els.speedRange, els.speedInput, 0.25, 4, 0.05, 2);
  linkSliderAndInput(els.qualityRange, els.qualityInput, 1, 100);
  bindPlaybackSpeedControls();

  bindTrimInputs();
  bindCropInputs();
  bindPreviewInteractions();
  bindEditorTabs();

  els.fileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    await handleSelectedFile(file);
  });

  els.dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.dropzone.classList.add("is-dragover");
  });

  els.dropzone.addEventListener("dragleave", () => {
    els.dropzone.classList.remove("is-dragover");
  });

  els.dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("is-dragover");
    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    els.fileInput.files = event.dataTransfer.files;
    await handleSelectedFile(file);
  });

  els.convertBtn.addEventListener("click", () => {
    convertToWebp().catch((error) => {
      const details = formatError(error);
      setStatus(`오류: ${details}`);
      appendLog(`Unhandled convert error: ${details}`);
      setProcessingState(false);
    });
  });

  els.estimateBtn.addEventListener("click", () => {
    estimateOutputSize().catch((error) => {
      const details = formatError(error);
      setStatus(`오류: ${details}`);
      appendLog(`Unhandled estimate error: ${details}`);
      setProcessingState(false);
    });
  });

  els.recommendBtn.addEventListener("click", () => {
    recommendByTargetSize().catch((error) => {
      const details = formatError(error);
      setStatus(`오류: ${details}`);
      appendLog(`Unhandled recommend error: ${details}`);
      setProcessingState(false);
    });
  });

  els.quickPreviewBtn.addEventListener("click", () => {
    generateSettingsPreview().catch((error) => {
      const details = formatError(error);
      setStatus(`오류: ${details}`);
      appendLog(`Unhandled preview error: ${details}`);
      setProcessingState(false);
    });
  });

  els.cancelBtn.addEventListener("click", () => {
    cancelConversion();
  });

  els.cropResetBtn.addEventListener("click", () => {
    if (!state.metadata) {
      return;
    }
    setCropToFullFrame();
    syncCropFromInputs();
    setStatus("크롭 범위를 원본 해상도 기준으로 초기화했습니다.");
  });

  els.cropToggleBtn.addEventListener("click", () => {
    if (!state.metadata || state.isProcessing) {
      return;
    }

    setCropEditEnabled(!state.cropEditEnabled);
    setStatus(state.cropEditEnabled ? "크롭 편집 모드 켜짐" : "크롭 편집 모드 꺼짐");
  });

  els.resizeResetBtn.addEventListener("click", () => {
    if (!state.metadata) {
      return;
    }
    const crop = getNormalizedCropFromInputs();
    els.resizeW.value = String(crop.w);
    els.resizeH.value = String(crop.h);
    setStatus("리사이즈 값을 현재 크롭 크기에 맞췄습니다.");
  });

  els.setStartBtn.addEventListener("click", () => {
    if (!state.metadata) {
      return;
    }
    applyTrimChange("start", els.sourcePreview.currentTime);
    setStatus("현재 재생 위치를 시작 시간으로 설정했습니다.");
  });

  els.setEndBtn.addEventListener("click", () => {
    if (!state.metadata) {
      return;
    }
    applyTrimChange("end", els.sourcePreview.currentTime);
    setStatus("현재 재생 위치를 종료 시간으로 설정했습니다.");
  });

  clearResult();
  resetPreviewSurface();
  updateActionButtons();
}

function bindPlaybackSpeedControls() {
  const syncPreviewSpeed = () => {
    const speed = clampDecimal(numberFromInput(els.speedInput), 0.25, 4, 0.05, 2);
    els.speedInput.value = speed.toFixed(2);
    els.speedRange.value = String(speed);
    if (Number.isFinite(els.sourcePreview.playbackRate)) {
      els.sourcePreview.playbackRate = speed;
    }
  };

  els.speedRange.addEventListener("input", syncPreviewSpeed);
  els.speedInput.addEventListener("input", syncPreviewSpeed);
  syncPreviewSpeed();
}

function bindEditorTabs() {
  if (!els.editorTabButtons.length || !els.editorTabPanels.length) {
    return;
  }

  const activateTab = (targetId) => {
    els.editorTabButtons.forEach((button) => {
      const isActive = button.dataset.tabTarget === targetId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    els.editorTabPanels.forEach((panel) => {
      const isActive = panel.id === targetId;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    });
  };

  const initialButton =
    Array.from(els.editorTabButtons).find((button) => button.classList.contains("is-active")) || els.editorTabButtons[0];

  if (initialButton?.dataset.tabTarget) {
    activateTab(initialButton.dataset.tabTarget);
  }

  els.editorTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.tabTarget;
      if (!targetId) {
        return;
      }
      activateTab(targetId);
    });
  });
}

function bindTrimInputs() {
  els.trimStart.addEventListener("input", () => {
    applyTrimChange("start", numberFromInput(els.trimStart));
  });

  els.trimEnd.addEventListener("input", () => {
    applyTrimChange("end", numberFromInput(els.trimEnd));
  });

  els.trimStartRange.addEventListener("input", () => {
    applyTrimChange("start", numberFromInput(els.trimStartRange));
  });

  els.trimEndRange.addEventListener("input", () => {
    applyTrimChange("end", numberFromInput(els.trimEndRange));
  });
}

function bindCropInputs() {
  [els.cropX, els.cropY, els.cropW, els.cropH].forEach((input) => {
    input.addEventListener("input", () => {
      syncCropFromInputs();
    });
  });
}

function bindPreviewInteractions() {
  els.sourcePreview.addEventListener("timeupdate", () => {
    enforceTrimLoop();
    updatePlayheadLabel();
  });

  els.sourcePreview.addEventListener("loadedmetadata", () => {
    updatePlayheadLabel();
  });

  els.sourcePreview.addEventListener("seeked", () => {
    enforceCurrentTimeWithinTrim();
    updatePlayheadLabel();
  });

  els.cropBox.addEventListener("pointerdown", (event) => {
    if (!state.metadata || state.isProcessing || !state.cropEditEnabled) {
      return;
    }

    const mode = event.target.closest("[data-handle]")?.dataset.handle ?? "move";
    const stageRect = els.sourceStage.getBoundingClientRect();
    if (stageRect.width <= 0 || stageRect.height <= 0) {
      return;
    }

    state.cropDrag = {
      active: true,
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startCrop: getNormalizedCropFromInputs(),
      stageRect,
    };

    els.cropBox.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  window.addEventListener("pointermove", (event) => {
    if (!state.cropDrag?.active || event.pointerId !== state.cropDrag.pointerId || !state.metadata) {
      return;
    }

    const { stageRect, startX, startY, startCrop, mode } = state.cropDrag;
    const dx = ((event.clientX - startX) * state.metadata.width) / stageRect.width;
    const dy = ((event.clientY - startY) * state.metadata.height) / stageRect.height;

    const nextCrop = computeDraggedCrop(startCrop, dx, dy, mode, state.metadata.width, state.metadata.height);
    setCropInputs(nextCrop);
    renderCropBox(nextCrop);
  });

  window.addEventListener("pointerup", (event) => {
    if (!state.cropDrag?.active || event.pointerId !== state.cropDrag.pointerId) {
      return;
    }

    try {
      els.cropBox.releasePointerCapture(event.pointerId);
    } catch {
      // ignore capture release errors
    }

    state.cropDrag = null;
  });
}

function linkSliderAndInput(slider, input, min, max) {
  slider.addEventListener("input", () => {
    input.value = slider.value;
  });

  input.addEventListener("input", () => {
    const normalized = clamp(Math.round(numberFromInput(input)), min, max);
    input.value = String(normalized);
    slider.value = String(normalized);
  });
}

function linkSliderAndDecimalInput(slider, input, min, max, step, decimals) {
  slider.addEventListener("input", () => {
    const value = clampDecimal(numberFromInput(slider), min, max, step, decimals);
    slider.value = String(value);
    input.value = value.toFixed(decimals);
  });

  input.addEventListener("input", () => {
    const value = clampDecimal(numberFromInput(input), min, max, step, decimals);
    input.value = value.toFixed(decimals);
    slider.value = String(value);
  });
}

async function handleSelectedFile(file) {
  if (!file.type.startsWith("video/")) {
    setStatus("오류: 동영상 파일만 선택할 수 있습니다.");
    appendLog(`Rejected file type: ${file.type || "unknown"}`);
    return;
  }

  clearObjectURLs();
  clearResult();
  resetPreviewSurface();

  state.currentFile = file;
  state.metadata = null;
  els.sizeWarning.hidden = file.size <= MAX_RECOMMENDED_BYTES;

  els.metaName.textContent = file.name;
  els.metaSize.textContent = formatBytes(file.size);
  els.metaResolution.textContent = "-";
  els.metaDuration.textContent = "-";

  try {
    const metadata = await readVideoMetadata(file);
    state.metadata = metadata;

    els.metaResolution.textContent = `${metadata.width} x ${metadata.height}`;
    els.metaDuration.textContent = formatDuration(metadata.duration);

    applyDefaultsFromMetadata(metadata);

    els.sourcePreview.src = state.sourceURL;
    els.sourcePreview.controls = true;
    els.sourcePreview.playbackRate = clampDecimal(numberFromInput(els.speedInput), 0.25, 4, 0.05, 2);
    els.sourcePreview.currentTime = 0;
    setCropEditEnabled(false);
    els.sourceStage.style.aspectRatio = `${metadata.width} / ${metadata.height}`;

    setStatus("파일 로드 완료. 미리보기에서 트림/크롭 후 변환하세요.");
    setSubStatus("트림은 바로 조절 가능, 크롭은 '크롭 편집 시작' 버튼을 눌러 조절하세요.");
    appendLog(
      `Loaded: ${file.name}, ${metadata.width}x${metadata.height}, duration ${metadata.duration.toFixed(2)}s`
    );
  } catch (error) {
    setStatus(`메타데이터 읽기 실패: ${error.message}`);
    appendLog(`Metadata error: ${error.stack ?? error.message}`);
    state.currentFile = null;
    state.metadata = null;
    resetPreviewSurface();
    clearObjectURLs();
  }

  updateActionButtons();
}

function applyDefaultsFromMetadata(metadata) {
  configureTrimRanges(metadata.duration);
  setTrimControls(0, metadata.duration);

  els.cropX.value = "0";
  els.cropY.value = "0";
  els.cropW.value = String(metadata.width);
  els.cropH.value = String(metadata.height);

  els.resizeW.value = String(metadata.width);
  els.resizeH.value = String(metadata.height);

  syncCropFromInputs();
  updatePlayheadLabel();
}

function configureTrimRanges(durationSec) {
  const duration = roundTo(Math.max(0, durationSec), 0.01);
  const max = String(duration);

  els.trimStart.max = max;
  els.trimEnd.max = max;
  els.trimStartRange.max = max;
  els.trimEndRange.max = max;
}

function setTrimControls(start, end) {
  const s = roundTo(start, 0.01);
  const e = roundTo(end, 0.01);

  els.trimStart.value = s.toFixed(2);
  els.trimEnd.value = e.toFixed(2);
  els.trimStartRange.value = String(s);
  els.trimEndRange.value = String(e);
}

function getTrimValues() {
  const start = numberFromInput(els.trimStart);
  const end = numberFromInput(els.trimEnd);
  return { start, end };
}

function applyTrimChange(changedField, rawValue) {
  if (!state.metadata) {
    return;
  }

  const current = getTrimValues();
  if (changedField === "start") {
    current.start = rawValue;
  } else {
    current.end = rawValue;
  }

  const normalized = normalizeTrimValues(current.start, current.end, state.metadata.duration, changedField);
  setTrimControls(normalized.start, normalized.end);

  enforceCurrentTimeWithinTrim();
  updatePlayheadLabel();
}

function normalizeTrimValues(start, end, duration, changedField) {
  const maxDuration = Math.max(0, duration);
  let s = clamp(start, 0, maxDuration);
  let e = clamp(end, 0, maxDuration);

  const minGap = maxDuration >= MIN_TRIM_GAP ? MIN_TRIM_GAP : 0;

  if (e < s) {
    if (changedField === "start") {
      e = s;
    } else {
      s = e;
    }
  }

  if (e - s < minGap) {
    if (changedField === "start") {
      e = clamp(s + minGap, 0, maxDuration);
      s = clamp(e - minGap, 0, maxDuration);
    } else {
      s = clamp(e - minGap, 0, maxDuration);
      e = clamp(s + minGap, 0, maxDuration);
    }
  }

  return { start: s, end: e };
}

function enforceCurrentTimeWithinTrim() {
  if (!state.metadata || !Number.isFinite(els.sourcePreview.currentTime)) {
    return;
  }
  const { start, end } = getTrimValues();

  if (els.sourcePreview.currentTime < start) {
    els.sourcePreview.currentTime = start;
  } else if (els.sourcePreview.currentTime > end) {
    els.sourcePreview.currentTime = end;
  }
}

function enforceTrimLoop() {
  if (!state.metadata || !Number.isFinite(els.sourcePreview.currentTime)) {
    return;
  }

  const { start, end } = getTrimValues();
  if (els.sourcePreview.currentTime < start) {
    els.sourcePreview.currentTime = start;
    return;
  }

  if (!els.sourcePreview.paused && end > start && els.sourcePreview.currentTime >= end) {
    els.sourcePreview.currentTime = start;
  }
}

function updatePlayheadLabel() {
  const current = Number.isFinite(els.sourcePreview.currentTime) ? els.sourcePreview.currentTime : 0;
  const duration = state.metadata?.duration ?? 0;
  els.playheadLabel.textContent = `현재 ${formatDuration(current)} / ${formatDuration(duration)}`;
}

function setCropToFullFrame() {
  if (!state.metadata) {
    return;
  }

  els.cropX.value = "0";
  els.cropY.value = "0";
  els.cropW.value = String(state.metadata.width);
  els.cropH.value = String(state.metadata.height);
}

function getRawCropFromInputs() {
  return {
    x: numberFromInput(els.cropX),
    y: numberFromInput(els.cropY),
    w: numberFromInput(els.cropW),
    h: numberFromInput(els.cropH),
  };
}

function getNormalizedCropFromInputs() {
  return normalizeCrop(getRawCropFromInputs());
}

function normalizeCrop(crop) {
  if (!state.metadata) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }

  const maxW = state.metadata.width;
  const maxH = state.metadata.height;

  let x = Number.isFinite(crop.x) ? Math.round(crop.x) : 0;
  let y = Number.isFinite(crop.y) ? Math.round(crop.y) : 0;
  let w = Number.isFinite(crop.w) ? Math.round(crop.w) : maxW;
  let h = Number.isFinite(crop.h) ? Math.round(crop.h) : maxH;

  x = clamp(x, 0, maxW - 1);
  y = clamp(y, 0, maxH - 1);

  const minW = Math.min(MIN_CROP_SIZE, maxW);
  const minH = Math.min(MIN_CROP_SIZE, maxH);

  w = clamp(w, minW, maxW - x);
  h = clamp(h, minH, maxH - y);

  if (x + w > maxW) {
    x = maxW - w;
  }
  if (y + h > maxH) {
    y = maxH - h;
  }

  return { x, y, w, h };
}

function setCropInputs(crop) {
  els.cropX.value = String(crop.x);
  els.cropY.value = String(crop.y);
  els.cropW.value = String(crop.w);
  els.cropH.value = String(crop.h);
}

function syncCropFromInputs() {
  if (!state.metadata) {
    return;
  }

  const normalized = getNormalizedCropFromInputs();
  setCropInputs(normalized);
  renderCropBox(normalized);
}

function renderCropBox(crop) {
  if (!state.metadata) {
    return;
  }

  const left = (crop.x / state.metadata.width) * 100;
  const top = (crop.y / state.metadata.height) * 100;
  const width = (crop.w / state.metadata.width) * 100;
  const height = (crop.h / state.metadata.height) * 100;

  els.cropBox.style.left = `${left}%`;
  els.cropBox.style.top = `${top}%`;
  els.cropBox.style.width = `${width}%`;
  els.cropBox.style.height = `${height}%`;
}

function computeDraggedCrop(startCrop, dx, dy, mode, maxW, maxH) {
  let x = startCrop.x;
  let y = startCrop.y;
  let w = startCrop.w;
  let h = startCrop.h;

  if (mode === "move") {
    x = clamp(startCrop.x + dx, 0, maxW - startCrop.w);
    y = clamp(startCrop.y + dy, 0, maxH - startCrop.h);
    return normalizeCrop({ x, y, w, h });
  }

  if (mode === "se") {
    w = clamp(startCrop.w + dx, MIN_CROP_SIZE, maxW - startCrop.x);
    h = clamp(startCrop.h + dy, MIN_CROP_SIZE, maxH - startCrop.y);
    return normalizeCrop({ x, y, w, h });
  }

  if (mode === "nw") {
    x = clamp(startCrop.x + dx, 0, startCrop.x + startCrop.w - MIN_CROP_SIZE);
    y = clamp(startCrop.y + dy, 0, startCrop.y + startCrop.h - MIN_CROP_SIZE);
    w = startCrop.w + (startCrop.x - x);
    h = startCrop.h + (startCrop.y - y);
    return normalizeCrop({ x, y, w, h });
  }

  if (mode === "ne") {
    y = clamp(startCrop.y + dy, 0, startCrop.y + startCrop.h - MIN_CROP_SIZE);
    w = clamp(startCrop.w + dx, MIN_CROP_SIZE, maxW - startCrop.x);
    h = startCrop.h + (startCrop.y - y);
    return normalizeCrop({ x, y, w, h });
  }

  if (mode === "sw") {
    x = clamp(startCrop.x + dx, 0, startCrop.x + startCrop.w - MIN_CROP_SIZE);
    w = startCrop.w + (startCrop.x - x);
    h = clamp(startCrop.h + dy, MIN_CROP_SIZE, maxH - startCrop.y);
    return normalizeCrop({ x, y, w, h });
  }

  return normalizeCrop(startCrop);
}

async function readVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    const tempUrl = URL.createObjectURL(file);
    state.sourceURL = tempUrl;
    video.src = tempUrl;

    video.onloadedmetadata = () => {
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
      });
    };

    video.onerror = () => {
      reject(new Error("브라우저에서 동영상 메타데이터를 읽을 수 없습니다."));
    };
  });
}

function validateOptions() {
  if (!state.currentFile || !state.metadata) {
    return { ok: false, message: "먼저 동영상 파일을 선택하세요." };
  }

  const trimStart = numberFromInput(els.trimStart);
  const trimEnd = numberFromInput(els.trimEnd);
  const crop = getNormalizedCropFromInputs();
  const resizeW = numberFromInput(els.resizeW);
  const resizeH = numberFromInput(els.resizeH);
  const fps = numberFromInput(els.fpsInput);
  const playbackSpeed = numberFromInput(els.speedInput);
  const quality = numberFromInput(els.qualityInput);

  const maxDuration = state.metadata.duration;
  if (!Number.isFinite(trimStart) || !Number.isFinite(trimEnd)) {
    return { ok: false, message: "트림 시작/종료 값을 확인하세요." };
  }
  if (trimStart < 0 || trimEnd <= trimStart || trimEnd > maxDuration) {
    return {
      ok: false,
      message: `트림 범위가 잘못되었습니다. 종료는 시작보다 커야 하고 최대 ${maxDuration.toFixed(2)}초 이하여야 합니다.`,
    };
  }

  if (!isPositiveInt(resizeW) || !isPositiveInt(resizeH)) {
    return { ok: false, message: "리사이즈 값은 1 이상의 정수여야 합니다." };
  }
  if (!isPositiveInt(fps) || fps < 1 || fps > 60) {
    return { ok: false, message: "FPS는 1~60 사이 정수여야 합니다." };
  }
  if (!Number.isFinite(playbackSpeed) || playbackSpeed < 0.25 || playbackSpeed > 4) {
    return { ok: false, message: "재생 속도는 0.25~4.00 사이여야 합니다." };
  }
  if (!isPositiveInt(quality) || quality < 1 || quality > 100) {
    return { ok: false, message: "품질은 1~100 사이 정수여야 합니다." };
  }

  return {
    ok: true,
    options: {
      trimStart,
      trimEnd,
      cropX: crop.x,
      cropY: crop.y,
      cropW: crop.w,
      cropH: crop.h,
      resizeW,
      resizeH,
      fps,
      playbackSpeed: clampDecimal(playbackSpeed, 0.25, 4, 0.05, 2),
      quality,
    },
  };
}

async function ensureFfmpegReady() {
  if (state.ffmpegReady && state.ffmpeg) {
    return;
  }

  const ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => {
    if (message) {
      appendLog(message);
    }
  });

  ffmpeg.on("progress", ({ progress }) => {
    if (state.isProcessing) {
      setProgress(clamp(progress * 100, 0, 100));
    }
  });

  setStatus("ffmpeg 엔진 로드 중...");
  appendLog("Loading ffmpeg core...");

  const localConfig = {
    coreURL: resolveLocalAssetURL("ffmpeg-core.js"),
    wasmURL: resolveLocalAssetURL("ffmpeg-core.wasm"),
  };

  try {
    await ffmpeg.load(localConfig);
    appendLog("Loaded core from local assets.");
  } catch (localError) {
    appendLog(`Local core load failed, trying CDN direct: ${formatError(localError)}`);

    try {
      await ffmpeg.load({
        coreURL: `${FFMPEG_CORE_BASE}/ffmpeg-core.js`,
        wasmURL: `${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`,
      });
      appendLog("Loaded core from CDN direct.");
    } catch (directError) {
      appendLog(`CDN direct core failed, trying CDN blob: ${formatError(directError)}`);
      try {
        const blobCoreURL = await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript");
        const blobWasmURL = await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm");

        await ffmpeg.load({
          coreURL: blobCoreURL,
          wasmURL: blobWasmURL,
        });
        appendLog("Loaded core from CDN blob.");
      } catch (blobError) {
        appendLog(`CDN blob core load failed, retrying core-only blob: ${formatError(blobError)}`);
        try {
          await ffmpeg.load({
            coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
            wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
          });
          appendLog("Loaded core from CDN blob core-only.");
        } catch (coreOnlyError) {
          throw new Error(`ffmpeg core load failed (local+direct+blob+coreOnly): ${formatError(coreOnlyError)}`);
        }
      }
    }
  }

  state.ffmpeg = ffmpeg;
  state.ffmpegReady = true;
  appendLog("ffmpeg core loaded.");
}

async function convertToWebp() {
  const validation = validateOptions();
  if (!validation.ok) {
    setStatus(validation.message);
    return;
  }

  const options = validation.options;
  setProcessingState(true);
  setProgress(1);
  setStatus("최종 변환 준비 중...");

  const inputExt = extensionOf(state.currentFile.name) || "mp4";
  const inputName = `input.${inputExt}`;
  const outputName = "output.webp";

  try {
    await ensureFfmpegReady();

    const ffmpeg = state.ffmpeg;
    await ffmpeg.writeFile(inputName, await fetchFile(state.currentFile));

    const args = buildFfmpegArgs(inputName, outputName, options, state.metadata.duration);
    appendLog(`ffmpeg ${args.join(" ")}`);

    setStatus("변환 중... 대용량 파일은 시간이 걸릴 수 있습니다.");
    await ffmpeg.exec(args);

    const outputData = await ffmpeg.readFile(outputName);
    const outputBlob = new Blob([outputData], { type: "image/webp" });

    setResultFromBlob(outputBlob, `${stripExtension(state.currentFile.name)}.webp`);

    const outputBytes = outputBlob.size;
    const inputBytes = state.currentFile.size;
    const deltaRatio = ((outputBytes - inputBytes) / inputBytes) * 100;

    els.outputSize.textContent = formatBytes(outputBytes);
    els.sizeDelta.textContent = formatDelta(deltaRatio);

    setSubStatus(`최종 결과 · FPS ${options.fps}, 속도 x${options.playbackSpeed.toFixed(2)}, 품질 ${options.quality}`);

    await safeDeleteFile(ffmpeg, inputName);
    await safeDeleteFile(ffmpeg, outputName);

    setProgress(100);
    setStatus("변환 완료. 다운로드 링크를 눌러 파일을 저장하세요.");
    appendLog(`Done. input=${formatBytes(inputBytes)}, output=${formatBytes(outputBytes)}`);
  } catch (error) {
    const details = formatError(error);
    if (state.isCancelled) {
      setStatus("변환이 취소되었습니다.");
      appendLog("Conversion cancelled by user.");
    } else {
      setStatus(`변환 실패: ${details}`);
      appendLog(`Conversion error: ${details}`);
    }
  } finally {
    setProcessingState(false);
    state.isCancelled = false;
    updateActionButtons();
  }
}

async function estimateOutputSize() {
  const validation = validateOptions();
  if (!validation.ok) {
    setStatus(validation.message);
    return;
  }

  const options = validation.options;
  const fullDuration = options.trimEnd - options.trimStart;
  const sampleDuration = Math.min(2, fullDuration);
  if (sampleDuration <= 0) {
    setStatus("예측을 위해 트림 범위를 먼저 확인하세요.");
    return;
  }

  setProcessingState(true);
  setProgress(1);
  setStatus("용량 예측 계산 중...");

  const inputExt = extensionOf(state.currentFile.name) || "mp4";
  const inputName = `estimate-input.${inputExt}`;
  const outputName = "estimate.webp";

  const sampleOptions = {
    ...options,
    trimEnd: options.trimStart + sampleDuration,
  };

  try {
    await ensureFfmpegReady();

    const ffmpeg = state.ffmpeg;
    await ffmpeg.writeFile(inputName, await fetchFile(state.currentFile));

    const args = buildFfmpegArgs(inputName, outputName, sampleOptions, state.metadata.duration);
    appendLog(`estimate ffmpeg ${args.join(" ")}`);
    await ffmpeg.exec(args);

    const outputData = await ffmpeg.readFile(outputName);
    const sampleBytes = new Blob([outputData], { type: "image/webp" }).size;
    const estimatedBytes = Math.max(1, Math.round(sampleBytes * (fullDuration / sampleDuration)));

    els.estimateSize.textContent = `약 ${formatBytes(estimatedBytes)}`;
    setSubStatus(`샘플 ${sampleDuration.toFixed(2)}초 기반 예측값 (실제와 오차 가능)`);
    setStatus("용량 예측 완료. 설정을 조정해 다시 예측할 수 있습니다.");

    await safeDeleteFile(ffmpeg, inputName);
    await safeDeleteFile(ffmpeg, outputName);

    setProgress(100);
  } catch (error) {
    const details = formatError(error);
    setStatus(`용량 예측 실패: ${details}`);
    appendLog(`Estimate error: ${details}`);
  } finally {
    setProcessingState(false);
    state.isCancelled = false;
    updateActionButtons();
  }
}

async function recommendByTargetSize() {
  const validation = validateOptions();
  if (!validation.ok) {
    setStatus(validation.message);
    return;
  }

  const targetMB = numberFromInput(els.targetSizeMB);
  if (!Number.isFinite(targetMB) || targetMB <= 0) {
    setStatus("목표 용량(MB)은 0보다 커야 합니다.");
    return;
  }

  const targetBytes = Math.round(targetMB * 1024 * 1024);
  const baseOptions = validation.options;
  const fullDuration = baseOptions.trimEnd - baseOptions.trimStart;
  const sampleDuration = Math.min(1.5, fullDuration);
  if (sampleDuration <= 0) {
    setStatus("추천을 위해 트림 범위를 먼저 확인하세요.");
    return;
  }

  const targetSampleBytes = targetBytes * (sampleDuration / fullDuration);

  setProcessingState(true);
  setProgress(1);
  setStatus("목표 용량 기준 FPS/품질 추천 계산 중...");

  const inputExt = extensionOf(state.currentFile.name) || "mp4";
  const inputName = `recommend-input.${inputExt}`;

  try {
    await ensureFfmpegReady();
    const ffmpeg = state.ffmpeg;

    await safeDeleteFile(ffmpeg, inputName);
    await ffmpeg.writeFile(inputName, await fetchFile(state.currentFile));

    const baselineSampleBytes = await runProbeSample(ffmpeg, inputName, baseOptions, sampleDuration);
    const baselineEstimatedBytes = Math.max(1, Math.round(baselineSampleBytes * (fullDuration / sampleDuration)));
    appendLog(`recommend baseline estimate=${formatBytes(baselineEstimatedBytes)} target=${formatBytes(targetBytes)}`);

    if (baselineEstimatedBytes <= targetBytes) {
      els.estimateSize.textContent = `약 ${formatBytes(baselineEstimatedBytes)}`;
      setSubStatus(
        `현재 설정이 이미 목표 이하입니다. (목표 ${formatBytes(targetBytes)}, 예상 ${formatBytes(baselineEstimatedBytes)})`
      );
      setStatus("추천 완료: 현재 설정 유지");
      setProgress(100);
      await safeDeleteFile(ffmpeg, inputName);
      return;
    }

    const fpsCandidates = buildFpsCandidates(baseOptions.fps);
    let best = null;
    let metTarget = true;

    const maxProbeRuns = fpsCandidates.length * 8 + 2;
    let probeRuns = 1;
    setProgress((probeRuns / maxProbeRuns) * 100);

    for (const fps of fpsCandidates) {
      const minQualityBytes = await runProbeSample(ffmpeg, inputName, { ...baseOptions, fps, quality: 1 }, sampleDuration);
      probeRuns += 1;
      setProgress((probeRuns / maxProbeRuns) * 100);

      if (minQualityBytes > targetSampleBytes) {
        continue;
      }

      let low = 1;
      let high = 100;
      let feasibleQuality = 1;
      let feasibleSampleBytes = minQualityBytes;
      let iterations = 0;

      while (low <= high && iterations < 7) {
        const mid = Math.floor((low + high) / 2);
        const sampleBytes = await runProbeSample(
          ffmpeg,
          inputName,
          { ...baseOptions, fps, quality: mid },
          sampleDuration
        );

        probeRuns += 1;
        setProgress((probeRuns / maxProbeRuns) * 100);
        iterations += 1;

        if (sampleBytes <= targetSampleBytes) {
          feasibleQuality = mid;
          feasibleSampleBytes = sampleBytes;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      best = { fps, quality: feasibleQuality, sampleBytes: feasibleSampleBytes };
      break;
    }

    if (!best) {
      const fallbackFps = fpsCandidates[fpsCandidates.length - 1] || 1;
      const fallbackBytes = await runProbeSample(
        ffmpeg,
        inputName,
        { ...baseOptions, fps: fallbackFps, quality: 1 },
        sampleDuration
      );
      best = { fps: fallbackFps, quality: 1, sampleBytes: fallbackBytes };
      metTarget = false;
      appendLog("No feasible combo under target. Returning minimum settings.");
    }

    const recommendedEstimateBytes = Math.max(1, Math.round(best.sampleBytes * (fullDuration / sampleDuration)));
    applyRecommendedFpsQuality(best.fps, best.quality);

    els.estimateSize.textContent = `약 ${formatBytes(recommendedEstimateBytes)}`;
    if (metTarget) {
      setSubStatus(
        `추천 적용 · 목표 ${targetMB.toFixed(1)}MB / 예상 ${formatBytes(recommendedEstimateBytes)} (샘플 ${sampleDuration.toFixed(2)}초)`
      );
      setStatus(`추천 완료: FPS ${best.fps}, 품질 ${best.quality}`);
    } else {
      setSubStatus(
        `최소값(FPS ${best.fps}, 품질 ${best.quality}) 기준 예상 ${formatBytes(recommendedEstimateBytes)} · 목표 ${targetMB.toFixed(1)}MB 미달성`
      );
      setStatus("추천 완료: 현재 설정 범위에서는 목표 용량 달성이 어렵습니다.");
    }
    setProgress(100);

    await safeDeleteFile(ffmpeg, inputName);
  } catch (error) {
    const details = formatError(error);
    setStatus(`추천 실패: ${details}`);
    appendLog(`Recommend error: ${details}`);
  } finally {
    setProcessingState(false);
    state.isCancelled = false;
    updateActionButtons();
  }
}

async function generateSettingsPreview() {
  const validation = validateOptions();
  if (!validation.ok) {
    setStatus(validation.message);
    return;
  }

  const options = validation.options;
  const originalDuration = options.trimEnd - options.trimStart;
  const previewDuration = Math.min(3, originalDuration);

  if (previewDuration <= 0) {
    setStatus("미리보기를 만들 수 없습니다. 트림 범위를 확인하세요.");
    return;
  }

  const previewOptions = {
    ...options,
    trimEnd: options.trimStart + previewDuration,
  };

  setProcessingState(true);
  setProgress(1);
  setStatus("설정 미리보기 생성 중...");

  const inputExt = extensionOf(state.currentFile.name) || "mp4";
  const inputName = `preview-input.${inputExt}`;
  const outputName = "preview.webp";

  try {
    await ensureFfmpegReady();

    const ffmpeg = state.ffmpeg;
    await ffmpeg.writeFile(inputName, await fetchFile(state.currentFile));

    const args = buildFfmpegArgs(inputName, outputName, previewOptions, state.metadata.duration);
    appendLog(`preview ffmpeg ${args.join(" ")}`);

    await ffmpeg.exec(args);

    const outputData = await ffmpeg.readFile(outputName);
    const outputBlob = new Blob([outputData], { type: "image/webp" });

    setResultFromBlob(outputBlob, `${stripExtension(state.currentFile.name)}-preview.webp`);

    els.outputSize.textContent = formatBytes(outputBlob.size);
    els.sizeDelta.textContent = `미리보기 ${previewDuration.toFixed(2)}초`;
    setSubStatus(
      `설정 미리보기 · FPS ${previewOptions.fps}, 속도 x${previewOptions.playbackSpeed.toFixed(2)}, 품질 ${previewOptions.quality}`
    );

    await safeDeleteFile(ffmpeg, inputName);
    await safeDeleteFile(ffmpeg, outputName);

    setProgress(100);
    setStatus("미리보기 생성 완료. FPS/품질 체감을 확인한 뒤 최종 변환을 실행하세요.");
    appendLog(`Preview done. size=${formatBytes(outputBlob.size)}, duration=${previewDuration.toFixed(2)}s`);
  } catch (error) {
    const details = formatError(error);
    if (state.isCancelled) {
      setStatus("미리보기 생성이 취소되었습니다.");
      appendLog("Preview generation cancelled by user.");
    } else {
      setStatus(`미리보기 생성 실패: ${details}`);
      appendLog(`Preview error: ${details}`);
    }
  } finally {
    setProcessingState(false);
    state.isCancelled = false;
    updateActionButtons();
  }
}

function buildFfmpegArgs(inputName, outputName, options, maxDuration) {
  const safeStart = clamp(options.trimStart, 0, maxDuration);
  const safeEnd = clamp(options.trimEnd, safeStart, maxDuration);
  const trimDuration = Math.max(0.01, safeEnd - safeStart);
  const speedExpr = formatSpeedExpr(options.playbackSpeed);

  const vf = [
    `setpts=${speedExpr}*PTS`,
    `crop=${options.cropW}:${options.cropH}:${options.cropX}:${options.cropY}`,
    `scale=${options.resizeW}:${options.resizeH}:flags=lanczos`,
    `fps=${options.fps}`,
  ].join(",");

  const args = [];
  if (safeStart > 0) {
    args.push("-ss", safeStart.toFixed(2));
  }

  args.push("-i", inputName);

  if (trimDuration < maxDuration) {
    args.push("-t", trimDuration.toFixed(2));
  }

  args.push(
    "-vf",
    vf,
    "-an",
    "-c:v",
    "libwebp",
    "-q:v",
    String(options.quality),
    "-compression_level",
    "6",
    "-loop",
    "0",
    "-preset",
    "picture",
    "-vsync",
    "0",
    outputName
  );

  return args;
}

async function runProbeSample(ffmpeg, inputName, options, sampleDuration) {
  const outputName = `probe-${Date.now()}-${state.probeSeq++}.webp`;
  const sampleOptions = {
    ...options,
    trimEnd: options.trimStart + sampleDuration,
  };

  const args = buildFfmpegArgs(inputName, outputName, sampleOptions, state.metadata.duration);
  await ffmpeg.exec(args);
  const outputData = await ffmpeg.readFile(outputName);
  const bytes = new Blob([outputData], { type: "image/webp" }).size;
  await safeDeleteFile(ffmpeg, outputName);
  return bytes;
}

function buildFpsCandidates(currentFps) {
  const values = [
    currentFps,
    Math.round(currentFps * 0.9),
    Math.round(currentFps * 0.75),
    Math.round(currentFps * 0.6),
    Math.round(currentFps * 0.45),
    Math.round(currentFps * 0.33),
    Math.round(currentFps * 0.25),
    1,
  ]
    .map((v) => clamp(Math.round(v), 1, 60))
    .sort((a, b) => b - a);

  return [...new Set(values)];
}

function applyRecommendedFpsQuality(fps, quality) {
  const normalizedFps = clamp(Math.round(fps), 1, 60);
  const normalizedQuality = clamp(Math.round(quality), 1, 100);

  els.fpsRange.value = String(normalizedFps);
  els.fpsInput.value = String(normalizedFps);
  els.qualityRange.value = String(normalizedQuality);
  els.qualityInput.value = String(normalizedQuality);
}

function setResultFromBlob(blob, filename) {
  if (state.resultURL) {
    URL.revokeObjectURL(state.resultURL);
  }

  state.resultURL = URL.createObjectURL(blob);
  els.resultPreview.src = state.resultURL;
  els.resultPreview.style.display = "block";

  els.downloadLink.href = state.resultURL;
  els.downloadLink.download = filename;
  els.downloadLink.classList.remove("disabled");
}

function cancelConversion() {
  if (!state.isProcessing) {
    return;
  }

  state.isCancelled = true;

  if (state.ffmpeg) {
    state.ffmpeg.terminate();
  }

  state.ffmpeg = null;
  state.ffmpegReady = false;

  setProcessingState(false);
  setProgress(0);
  setStatus("작업을 취소했습니다. 다음 실행 시 엔진을 다시 로드합니다.");
  updateActionButtons();
}

function setCropEditEnabled(enabled) {
  state.cropEditEnabled = Boolean(enabled);
  els.cropOverlay.hidden = !state.cropEditEnabled;
  // Native video controls can cover bottom resize handles.
  els.sourcePreview.controls = !state.cropEditEnabled;
  els.cropToggleBtn.textContent = state.cropEditEnabled ? "크롭 편집 종료" : "크롭 편집 시작";
  els.cropToggleBtn.classList.toggle("is-active", state.cropEditEnabled);

  if (!state.cropEditEnabled) {
    state.cropDrag = null;
    if (state.metadata && !state.isProcessing) {
      setSubStatus("트림은 바로 조절 가능, 크롭은 '크롭 편집 시작' 버튼을 눌러 조절하세요.");
    }
  } else if (state.metadata && !state.isProcessing) {
    setSubStatus("크롭 편집 중에는 마커 가림 방지를 위해 하단 비디오 컨트롤이 숨겨집니다.");
  }
}

function setProcessingState(isProcessing) {
  state.isProcessing = isProcessing;
  updateActionButtons();
}

function updateActionButtons() {
  const hasFile = Boolean(state.currentFile && state.metadata);
  els.recommendBtn.disabled = !hasFile || state.isProcessing;
  els.estimateBtn.disabled = !hasFile || state.isProcessing;
  els.convertBtn.disabled = !hasFile || state.isProcessing;
  els.quickPreviewBtn.disabled = !hasFile || state.isProcessing;
  els.cancelBtn.disabled = !state.isProcessing;
  els.cropToggleBtn.disabled = !hasFile || state.isProcessing;
  els.setStartBtn.disabled = !hasFile || state.isProcessing;
  els.setEndBtn.disabled = !hasFile || state.isProcessing;
  els.cropResetBtn.disabled = !hasFile || state.isProcessing;
  els.resizeResetBtn.disabled = !hasFile || state.isProcessing;
}

function clearResult() {
  if (state.resultURL) {
    URL.revokeObjectURL(state.resultURL);
    state.resultURL = null;
  }

  els.resultPreview.src = "";
  els.resultPreview.style.display = "none";
  els.outputSize.textContent = "-";
  els.sizeDelta.textContent = "-";
  els.estimateSize.textContent = "-";
  els.downloadLink.href = "#";
  els.downloadLink.classList.add("disabled");
  setSubStatus("");
}

function resetPreviewSurface() {
  els.sourcePreview.removeAttribute("src");
  els.sourcePreview.controls = true;
  els.sourcePreview.load();
  setCropEditEnabled(false);
  els.playheadLabel.textContent = "현재 00:00.00 / 00:00.00";
  els.sourceStage.style.aspectRatio = "16 / 9";

  configureTrimRanges(0);
  setTrimControls(0, 0);

  els.cropX.value = "0";
  els.cropY.value = "0";
  els.cropW.value = "0";
  els.cropH.value = "0";
}

function clearObjectURLs() {
  if (state.sourceURL) {
    URL.revokeObjectURL(state.sourceURL);
    state.sourceURL = null;
  }
}

function appendLog(line) {
  state.logLines.push(line);
  if (state.logLines.length > LOG_LIMIT) {
    state.logLines = state.logLines.slice(-LOG_LIMIT);
  }

  els.logOutput.textContent = state.logLines.join("\n");
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function setSubStatus(message) {
  els.subStatusText.textContent = message;
}

function setProgress(value) {
  els.progressBar.style.width = `${clamp(value, 0, 100)}%`;
}

function numberFromInput(input) {
  return Number(input.value);
}

function resolveLocalAssetURL(fileName) {
  return new URL(`${FFMPEG_LOCAL_CORE_BASE}/${fileName}`, window.location.href).href;
}

function formatError(error) {
  if (error instanceof Error) {
    return error.stack || error.message || error.name || "Unknown Error";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  if (typeof error === "undefined") {
    return "알 수 없는 오류(undefined)";
  }

  return String(error);
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function clampDecimal(value, min, max, step, decimals) {
  if (!Number.isFinite(value)) {
    return min;
  }
  const clamped = Math.min(Math.max(value, min), max);
  const snapped = Math.round(clamped / step) * step;
  const factor = 10 ** decimals;
  return Math.round(snapped * factor) / factor;
}

function formatSpeedExpr(speed) {
  const safeSpeed = Math.max(0.05, Number(speed) || 1);
  return (1 / safeSpeed).toFixed(6);
}

function roundTo(value, step) {
  if (!Number.isFinite(value) || step <= 0) {
    return 0;
  }
  return Math.round(value / step) * step;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const num = bytes / 1024 ** exp;
  return `${num.toFixed(num >= 100 || exp === 0 ? 0 : 2)} ${units[exp]}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00.00";
  }

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(2);

  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.padStart(5, "0")}`;
  }

  return `${String(m).padStart(2, "0")}:${s.padStart(5, "0")}`;
}

function formatDelta(deltaRatio) {
  if (!Number.isFinite(deltaRatio)) {
    return "-";
  }

  if (deltaRatio <= 0) {
    return `감소 ${Math.abs(deltaRatio).toFixed(1)}%`;
  }

  return `증가 +${deltaRatio.toFixed(1)}%`;
}

function extensionOf(filename) {
  const index = filename.lastIndexOf(".");
  if (index === -1 || index === filename.length - 1) {
    return "";
  }
  return filename.slice(index + 1).toLowerCase();
}

function stripExtension(filename) {
  const index = filename.lastIndexOf(".");
  if (index === -1) {
    return filename;
  }
  return filename.slice(0, index);
}

async function safeDeleteFile(ffmpeg, filename) {
  try {
    await ffmpeg.deleteFile(filename);
  } catch {
    // ignore cleanup errors
  }
}

window.addEventListener("beforeunload", () => {
  clearObjectURLs();

  if (state.resultURL) {
    URL.revokeObjectURL(state.resultURL);
  }

  if (state.ffmpeg) {
    state.ffmpeg.terminate();
  }
});
