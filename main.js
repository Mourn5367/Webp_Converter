import { FFmpeg } from "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js";
import { fetchFile, toBlobURL } from "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js";

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
  qualityRange: document.querySelector("#qualityRange"),
  qualityInput: document.querySelector("#qualityInput"),
  cropResetBtn: document.querySelector("#cropResetBtn"),
  resizeResetBtn: document.querySelector("#resizeResetBtn"),
  convertBtn: document.querySelector("#convertBtn"),
  cancelBtn: document.querySelector("#cancelBtn"),
  statusText: document.querySelector("#statusText"),
  subStatusText: document.querySelector("#subStatusText"),
  progressBar: document.querySelector("#progressBar"),
  outputSize: document.querySelector("#outputSize"),
  sizeDelta: document.querySelector("#sizeDelta"),
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
  workerBootstrapURL: null,
  workerProxyInstalled: false,
};

const MAX_RECOMMENDED_BYTES = 200 * 1024 * 1024;
const LOG_LIMIT = 120;
const MIN_TRIM_GAP = 0.1;
const MIN_CROP_SIZE = 8;
const FFMPEG_PACKAGE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm";
const FFMPEG_CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd";
const FFMPEG_REMOTE_WORKER_URL = `${FFMPEG_PACKAGE_BASE}/worker.js`;

init();

function init() {
  installWorkerProxy();

  linkSliderAndInput(els.fpsRange, els.fpsInput, 1, 30);
  linkSliderAndInput(els.qualityRange, els.qualityInput, 1, 100);

  bindTrimInputs();
  bindCropInputs();
  bindPreviewInteractions();

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
  if (!isPositiveInt(fps) || fps < 1 || fps > 30) {
    return { ok: false, message: "FPS는 1~30 사이 정수여야 합니다." };
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

  cleanupWorkerBootstrapURL();
  state.workerBootstrapURL = createWorkerImportBridgeURL(FFMPEG_REMOTE_WORKER_URL);

  const directConfig = {
    coreURL: `${FFMPEG_CORE_BASE}/ffmpeg-core.js`,
    wasmURL: `${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`,
    workerURL: state.workerBootstrapURL,
  };

  try {
    await ffmpeg.load(directConfig);
  } catch (error) {
    appendLog(`Direct core load failed, trying blob core: ${formatError(error)}`);
    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
        workerURL: state.workerBootstrapURL,
      });
    } catch (blobError) {
      cleanupWorkerBootstrapURL();
      throw new Error(`ffmpeg core load failed (direct+blob): ${formatError(blobError)}`);
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

    setSubStatus(`최종 결과 · FPS ${options.fps}, 품질 ${options.quality}`);

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
    setSubStatus(`설정 미리보기 · FPS ${previewOptions.fps}, 품질 ${previewOptions.quality}`);

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

  const vf = [
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
  cleanupWorkerBootstrapURL();

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

async function createSameOriginWorkerURL(remoteWorkerURL) {
  const response = await fetch(remoteWorkerURL);
  if (!response.ok) {
    throw new Error(`Worker 스크립트 다운로드 실패: ${response.status} ${response.statusText}`);
  }

  const source = await response.text();
  const rewritten = rewriteRelativeModuleImports(source, remoteWorkerURL);
  return URL.createObjectURL(new Blob([rewritten], { type: "text/javascript" }));
}

function createWorkerImportBridgeURL(remoteWorkerURL) {
  const source = `import "${remoteWorkerURL}";`;
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

function rewriteRelativeModuleImports(source, fileURL) {
  const importPattern = /((?:import|export)\s+(?:[^'"]+?\s+from\s+)?)(['"])(\.{1,2}\/[^'"]+)\2/g;
  const sideEffectImportPattern = /(import\s*)(['"])(\.{1,2}\/[^'"]+)\2/g;

  const replaceImport = (_, prefix, quote, relPath) => {
    const absolute = new URL(relPath, fileURL).href;
    return `${prefix}${quote}${absolute}${quote}`;
  };

  let rewritten = source.replace(importPattern, replaceImport);
  rewritten = rewritten.replace(sideEffectImportPattern, replaceImport);
  return rewritten;
}

function cleanupWorkerBootstrapURL() {
  if (state.workerBootstrapURL) {
    URL.revokeObjectURL(state.workerBootstrapURL);
    state.workerBootstrapURL = null;
  }
}

function installWorkerProxy() {
  if (state.workerProxyInstalled || typeof window === "undefined" || typeof window.Worker !== "function") {
    return;
  }

  const NativeWorker = window.Worker;
  window.Worker = class WorkerProxy extends NativeWorker {
    constructor(scriptURL, options) {
      const raw = typeof scriptURL === "string" ? scriptURL : String(scriptURL);
      const shouldSwap = raw.includes("/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js");
      const nextURL = shouldSwap && state.workerBootstrapURL ? state.workerBootstrapURL : scriptURL;
      super(nextURL, options);
    }
  };

  state.workerProxyInstalled = true;
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
  cleanupWorkerBootstrapURL();

  if (state.resultURL) {
    URL.revokeObjectURL(state.resultURL);
  }

  if (state.ffmpeg) {
    state.ffmpeg.terminate();
  }
});
