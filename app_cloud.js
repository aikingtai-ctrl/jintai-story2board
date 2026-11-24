// 金泰 Story2Board · 云端与国内直连双模交互引擎 (app_cloud.js)
(function () {
  'use strict';

  const Q = new URLSearchParams(location.search);
  const IS_PUBLIC_STATIC = /\.github\.io$|\.pages\.dev$/i.test(location.hostname);
  const TUNNEL_OVERRIDE = Q.get('tunnel') || '';

  const CAMERA_GRAMMAR_ALTERNATIVES = [
    {
      option_tag: '方案A · 影史大师首选（叙事主推）',
      scale_override: null,
      angle_override: null,
      move_override: null,
      rationale_prefix: '【AI副导演·主推镜头】直接汲取影史名片同款调度：',
    },
    {
      option_tag: '方案B · 心理张力递进（过肩/近景推镜）',
      scale_override: '近景',
      angle_override: '平视',
      move_override: '缓慢推镜',
      rationale_prefix: '【AI副导演·情绪递进变奏】将视距收紧至 85mm 浅景深近景并配合极缓慢推镜，剥离环境干扰，把观众视线锁死在角色微表情与眼神潜台词上：',
    },
    {
      option_tag: '方案C · 空间戏剧张力（低机位仰拍/框中框遮挡）',
      scale_override: '中全景',
      angle_override: '低机位',
      move_override: '固定 / 横移',
      rationale_prefix: '【AI副导演·空间构图变奏】采用前景门框/器物遮挡或低角度仰拍，以建筑几何线条切割画面，利用环境负空间外化角色内心的孤立与宿命感：',
    },
  ];

  let presetBoards = {};
  let currentTemplateKey = 'neon_rain_detective';
  let currentBoard = null;
  let top250Rows = [];
  let fullIndexLoaded = false;
  let indexStats = {
    distilled_top250_films: 250,
    top250_master_shots: 10675,
    indexed_master_shots: 58610,
    total_library_films: 66000,
    total_visual_library_shots: 3566502,
  };
  let tunnelBase = '';
  let liveTunnelData = null;
  let modalCopyText = '';

  function escHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cloneObj(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function showToast(msg, duration = 4000) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.style.display = 'none';
    }, duration);
  }

  function decodeCompactTable(payload) {
    if (!payload || !Array.isArray(payload.cols) || !Array.isArray(payload.rows)) return [];
    const cols = payload.cols;
    return payload.rows.map((arr) => {
      const obj = { is_top250: 1 };
      for (let i = 0; i < cols.length; i++) {
        obj[cols[i]] = arr[i];
      }
      return obj;
    });
  }

  function sanitizePositivePrompt(text) {
    const replacements = {
      '不可见': '隐入幽暗背景',
      '无镀膜': '复古单层光学古董镜片',
      '无影': '均匀漫射柔光',
      '不要': '保持纯粹',
      '没有': '呈现纯净',
      '毫无': '完全呈现',
      '不再': '持续',
      '不能': '克制',
      '别回头': '目视前方',
    };
    let out = String(text || '');
    for (const [k, v] of Object.entries(replacements)) {
      out = out.split(k).join(v);
    }
    return out;
  }

  function compileAnchorPrompt(consistency) {
    return sanitizePositivePrompt(
      `一张 16:9 画幅的电影剧组核心角色与场景设定母图（Consistency Anchor Sheet，${consistency.film_stock || '35mm胶片'}）。` +
      `画面中央平视中近景清晰展现主角：${consistency.chr_desc || ''}，` +
      `手持标志性道具：${consistency.prp_desc || ''}，` +
      `所处核心场景：${consistency.scn_desc || ''}。` +
      `电影级戏剧性冷暖光影，人物面部五官骨相清晰立体，服装材质肌理逼真，严禁文字与水印。`
    );
  }

  function compileConsistentShotPrompt(consistency, beat, opt, useImageRefToken) {
    const chrDesc = consistency.chr_desc || '';
    const scnDesc = consistency.scn_desc || '';
    const prpDesc = consistency.prp_desc || '';
    const filmStock = consistency.film_stock || '35毫米胶片电影剧照质感';
    const ar = consistency.aspect_ratio || '16:9';

    const scale = opt.shot_scale || beat.preferred_scale || '中景';
    const angle = opt.camera_angle || beat.preferred_angle || '平视';
    const move = opt.camera_movement || '固定';
    const lens = opt.lens_type || '标准定焦';
    const dof = opt.dof || '浅景深';
    const light = opt.lighting || '戏剧性冷暖侧逆光';
    const comp = opt.composition || '三分法电影构图';
    const refFilm = opt.film_title_zh || '影史经典';
    const scriptAction = beat.script_text || '';

    const prefix = useImageRefToken
      ? `基于 <image1> 中的核心人物与美术设定，生成一张 ${ar} 画幅的电影分镜剧照（致敬《${refFilm}》摄影美学，${filmStock}）。严格保持 <image1> 主角的面部五官骨相、发型与服装材质完全一致（${chrDesc}）。`
      : `一张 ${ar} 画幅的电影级写实分镜剧照（致敬《${refFilm}》摄影美学，${filmStock}）。【锁定主角 ${consistency.chr_id || '@CHR'}】：${chrDesc}。`;

    const body =
      `【锁定场景 ${consistency.scn_id || '@SCN'}】：${scnDesc}。` +
      `【锁定道具 ${consistency.prp_id || '@PRP'}】：${prpDesc}。` +
      `【本镜画面与表演】：${scriptAction} ` +
      `【摄影机位与视听调度】：采用${scale}、${angle}机位，${lens}镜头（${dof}），运镜方式为${move}；` +
      `布光采用${light}，构图遵循${comp}，光影层次深邃，材质肌理纤毫毕现。`;

    return sanitizePositivePrompt(prefix + body);
  }

  function compileLpaDualPrompt(consistency, refBeatText, targetBeat, opt) {
    const chrDesc = consistency.chr_desc || '';
    const scnDesc = consistency.scn_desc || '';
    const prpDesc = consistency.prp_desc || '';
    const filmStock = consistency.film_stock || '35mm cinematic film still';
    const scale = opt.shot_scale || '中景';
    const angle = opt.camera_angle || '平视';
    const light = opt.lighting || '电影级戏剧光影';
    const comp = opt.composition || '三分法构图';

    return sanitizePositivePrompt(
      `上下双联电影故事板（A two-panel stacked cinematic storyboard, ${filmStock}, 严禁任何文字水印）：` +
      `【上半幅参考锚点面板 (Top Reference Panel)】：平视中近景标准肖像定妆镜，展现主角（${chrDesc}），手持或佩带（${prpDesc}），` +
      `立于（${scnDesc}）之中，${refBeatText}；` +
      `【下半幅目标故事面板 (Bottom Story Panel)】：同一主角（100%相同五官骨相、相同发型与相同服装：${chrDesc}）` +
      `在同一时代空间（${scnDesc}）中的新镜头——${targetBeat.script_text || ''}，` +
      `采用${scale}、${angle}机位，${light}，${comp}，上下两幅画面人物身份与美术影调严丝合缝。`
    );
  }

  function parseFreeformStoryToBeats(storyText) {
    let lines = String(storyText || '')
      .split(/[\n。！？!?；;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 6);
    if (!lines.length) {
      lines = [String(storyText || '').trim() || '主角独自走在雨夜街头，停步回望霓虹闪烁的橱窗。'];
    }
    while (lines.length < 4) {
      if (lines.length === 1) lines.push(`${lines[0]}，镜头推进至人物近景，展现细腻眼神变化`);
      else if (lines.length === 2) lines.push('特写捕捉关键道具与人物手部微动作，光影反差强烈，气氛升至顶点');
      else lines.push('远景拉出人物在宏大空间环境中的孤立剪影，留下电影感余韵');
    }
    lines = lines.slice(0, 6);

    const scaleProg = ['全景', '中景', '特写', '远景', '中近景', '近景'];
    const angleProg = ['平视', '平视', '仰拍', '低机位', '高机位', '平视'];
    const emoProg = ['孤独', '压抑', '猜忌', '苍凉', '悬疑', '温柔'];
    const titles = ['开场建立 (Establish)', '关系推进 (Develop)', '情绪焦点 (Climax)', '余韵收束 (Resolve)', '转折变奏 (Turn)', '终章定格 (Ending)'];
    const kwDict = ['雨', '夜', '走廊', '楼梯', '窗', '特写', '雪', '街', '灯', '剑', '车', '酒', '海', '林', '光', '影', '背影', '对视', '刀', '庙', '烛', '信'];

    return lines.map((text, idx) => {
      const kws = kwDict.filter((kw) => text.includes(kw));
      if (!kws.length) kws.push(scaleProg[idx % scaleProg.length], emoProg[idx % emoProg.length]);
      return {
        beat_no: idx + 1,
        beat_title: `第 ${String(idx + 1).padStart(2, '0')} 镜 · ${titles[idx % titles.length]}`,
        script_text: text,
        dialogue: '',
        duration_sec: 4.0,
        preferred_scale: scaleProg[idx % scaleProg.length],
        preferred_angle: angleProg[idx % angleProg.length],
        preferred_emotion: emoProg[idx % emoProg.length],
        search_keywords: kws.slice(0, 4).join(' '),
      };
    });
  }

  function searchLocalShots({ query = '', scale = '', angle = '', move = '', emotion = '', limit = 24 } = {}) {
    const t0 = performance.now();
    const tokens = String(query || '').trim().split(/[\s,，。；;、·/]+/).filter(Boolean).slice(0, 5);

    const baseFiltered = top250Rows.filter((r) => {
      if (scale && r.shot_scale !== scale) return false;
      if (angle && r.camera_angle !== angle) return false;
      if (move && !String(r.camera_movement || '').includes(move)) return false;
      if (emotion && !String(r.emotions || '').includes(emotion)) return false;
      return true;
    });

    const rowBlob = (r) => `${r.film_title_zh || ''} ${r.director || ''} ${r.dp || ''} ${r.emotions || ''} ${r.lighting || ''} ${r.composition || ''} ${r.director_rationale || ''} ${r.shot_scale || ''} ${r.camera_angle || ''}`;

    let matched = baseFiltered;
    if (tokens.length) {
      matched = baseFiltered.filter((r) => {
        const blob = rowBlob(r);
        return tokens.every((tok) => blob.includes(tok));
      });
      if (matched.length < 3 && tokens.length > 1) {
        matched = baseFiltered.filter((r) => {
          const blob = rowBlob(r);
          return tokens.some((tok) => blob.includes(tok));
        });
      }
    }

    matched.sort((a, b) => (b.director_rationale || '').length - (a.director_rationale || '').length);
    const sliced = matched.slice(0, limit);
    return {
      count: sliced.length,
      elapsed_ms: Number((performance.now() - t0).toFixed(2)),
      results: sliced,
    };
  }

  function updateHealthBanner() {
    const el = document.getElementById('healthInfo');
    const st = (liveTunnelData && liveTunnelData.ok && liveTunnelData.stats)
      ? liveTunnelData.stats
      : indexStats;
    const topFilms = Number(st.distilled_top250_films || 250);
    const totalShots = Number(st.total_visual_library_shots || 3266777);
    const totalFilms = Number(st.total_library_films || 61000);
    const wanLabel = (totalShots / 10000).toFixed(1) + '万+';

    const badgeEl = document.getElementById('brandBadge');
    if (badgeEl) badgeEl.textContent = `AI 分镜副导演 · ${topFilms}部影史名片 / ${wanLabel}镜索引`;
    const tabIdxEl = document.getElementById('tabBtnIndex');
    if (tabIdxEl) tabIdxEl.textContent = `📚 ${topFilms}名片/${wanLabel}镜索引库`;
    const secTitleEl = document.getElementById('indexSectionTitle');
    if (secTitleEl) secTitleEl.textContent = `📚 蒸馏 ${topFilms} 部影史名片 · ${wanLabel} 电影分镜索引库`;
    document.title = `金泰 Story2Board · AI 分镜副导演与 ${wanLabel} 电影分镜索引工作台`;

    if (!el) return;
    if (liveTunnelData && liveTunnelData.ok) {
      const gpus = Number(liveTunnelData.idle_gpu_count || 0);
      const gpuLabel = gpus > 0 ? `${gpus} 张空闲就绪` : '队列运行中';
      el.innerHTML =
        `✅ 实时连线金泰 8×H100 智算中枢 ｜ <strong>${topFilms}</strong> 部影史名片 ｜ ` +
        `<strong>${Number(st.indexed_master_shots || 58610).toLocaleString()}</strong> 条精标母镜 ｜ ` +
        `<strong>${totalShots.toLocaleString()}</strong> 全量镜头（${totalFilms.toLocaleString()} 部） ｜ H100：<strong>${escHtml(gpuLabel)}</strong>`;
    } else {
      const loadedCount = top250Rows.length || Number(st.top250_master_shots || 10675);
      const suffix = fullIndexLoaded ? '' : '（全量检索索引后台加载中…）';
      el.innerHTML =
        `✅ 云端独立交互模式 ｜ <strong>${topFilms}</strong> 部影史名片 ｜ ` +
        `<strong>${loadedCount.toLocaleString()}</strong> 条精标母镜就绪（${totalShots.toLocaleString()} 全库总目）${suffix}`;
    }
  }

  async function probeHealthEndpoint(base) {
    const url = (base ? base.replace(/\/$/, '') : '') + '/__s2b_health';
    const r = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout ? AbortSignal.timeout(3500) : undefined,
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (j && j.ok === true) return j;
    return null;
  }

  async function discoverTunnel() {
    try {
      if (TUNNEL_OVERRIDE && /^https?:\/\//i.test(TUNNEL_OVERRIDE)) {
        const res = await probeHealthEndpoint(TUNNEL_OVERRIDE);
        if (res) {
          tunnelBase = TUNNEL_OVERRIDE.replace(/\/$/, '');
          liveTunnelData = res;
          updateHealthBanner();
          return;
        }
      }

      if (!IS_PUBLIC_STATIC && location.protocol.startsWith('http')) {
        try {
          const sameOrigin = await probeHealthEndpoint('');
          if (sameOrigin) {
            tunnelBase = '';
            liveTunnelData = sameOrigin;
            updateHealthBanner();
            return;
          }
        } catch {}
      }

      const candidates = [
        `/jintai-domestic-portal/tunnel.json?t=${Math.floor(Date.now() / 60000)}`,
        `./tunnel_hint.json?t=${Math.floor(Date.now() / 60000)}`,
        'https://testingcf.jsdelivr.net/gh/aikingtai-ctrl/jintai-domestic-portal@main/tunnel.json',
      ];
      for (const u of candidates) {
        try {
          const r = await fetch(u, {
            cache: 'no-store',
            signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined,
          });
          if (!r.ok) continue;
          const j = await r.json();
          if (j && typeof j.tunnel_url === 'string' && j.tunnel_url.startsWith('https://')) {
            const candidateBase = j.tunnel_url.replace(/\/$/, '');
            const health = await probeHealthEndpoint(candidateBase);
            if (health) {
              tunnelBase = candidateBase;
              liveTunnelData = health;
              updateHealthBanner();
              return;
            }
          }
        } catch {}
      }
    } catch {}
    updateHealthBanner();
  }

  function renderBoardUI(board) {
    currentBoard = board;
    document.getElementById('projTitle').value = board.title || '';
    document.getElementById('projStory').value = board.logline || '';
    const cl = board.consistency_layer || {};
    document.getElementById('chrDesc').value = cl.chr_desc || '';
    document.getElementById('scnDesc').value = cl.scn_desc || '';
    document.getElementById('prpDesc').value = cl.prp_desc || '';
    document.getElementById('filmStock').value = cl.film_stock || '';

    const anchorImg = document.getElementById('anchorImg');
    const anchorEmpty = document.getElementById('anchorEmpty');
    if (board.anchor_image_url) {
      anchorImg.src = board.anchor_image_url;
      anchorImg.style.display = 'block';
      anchorEmpty.style.display = 'none';
    } else {
      anchorImg.style.display = 'none';
      anchorEmpty.style.display = 'block';
    }

    document.getElementById('renderMetrics').textContent =
      board.total_render_sec ? `⚡ 金泰 8×H100 实渲总耗时：${board.total_render_sec} 秒` : '';

    const grid = document.getElementById('shotsGrid');
    grid.innerHTML = '';
    (board.shots || []).forEach((shot, sIdx) => {
      const selIdx = shot.selected_option_index || 0;
      const opt = shot.selected_option || (shot.options || [])[selIdx] || {};
      const card = document.createElement('div');
      card.className = 'shot-card';

      const optsHtml = (shot.options || []).map((o, oIdx) => `
        <button class="opt-pill ${oIdx === selIdx ? 'selected' : ''}" onclick="selectCameraOption(${sIdx}, ${oIdx})">
          <div>${escHtml(o.option_tag)}</div>
          <div style="font-size:16.5px; color:#93c5fd; margin-top:4px;">
            ${escHtml(o.shot_scale)} · ${escHtml(o.camera_angle)} · ${escHtml(o.camera_movement)}<br/>
            致敬《${escHtml(o.film_title_zh)}》(${escHtml(o.year)})
          </div>
        </button>
      `).join('');

      const imgContent = shot.image_url
        ? `<img src="${escHtml(shot.image_url)}" alt="Shot ${escHtml(shot.shot_no)}" />`
        : `<div style="color:#94a3b8; padding:20px; text-align:center;">已编译本镜锁脸提示词<br/>点击「🎯 单镜靶向重绘」或「⚡ ② 生成执行包」获取完整提示词</div>`;

      card.innerHTML = `
        <div class="shot-top">
          <div>
            <span class="shot-badge">${escHtml(shot.shot_id)}</span>
            <strong style="font-size:22px; margin-left:8px;">${escHtml(shot.beat_title)}</strong>
          </div>
          <button class="btn btn-outline" style="padding:6px 14px; font-size:17.5px;" onclick="reviseSingleShot(${Number(shot.shot_no)}, ${sIdx})">
            🎯 单镜靶向重绘 (不伤全局)
          </button>
        </div>
        <div class="shot-img-box">${imgContent}</div>
        <div>
          <label style="font-size:18px; margin-bottom:4px;">剧本动作描述（可随时修改并单镜重绘）：</label>
          <textarea id="shotScript_${sIdx}" rows="2" style="margin-bottom:8px;">${escHtml(shot.script_text || '')}</textarea>
        </div>
        <div>
          <label style="font-size:18px; margin-bottom:6px;">🎥 AI 副导演推荐的 3 套影史机位方案（点击切换）：</label>
          <div class="option-tabs">${optsHtml}</div>
        </div>
        <div class="rationale-box">
          <div style="font-weight:800; color:#93c5fd; margin-bottom:4px;">
            💡 为什么这么运镜（AI 副导演情绪动机解析 · 对标《${escHtml(opt.film_title_zh || '')}》${escHtml(opt.director || '')} / ${escHtml(opt.dp || '')}）：
          </div>
          <div>${escHtml(opt.director_rationale || '')}</div>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  function syncBoardFromInputs() {
    if (!currentBoard) return;
    currentBoard.title = document.getElementById('projTitle').value;
    currentBoard.logline = document.getElementById('projStory').value;
    if (!currentBoard.consistency_layer) currentBoard.consistency_layer = {};
    currentBoard.consistency_layer.chr_desc = document.getElementById('chrDesc').value;
    currentBoard.consistency_layer.scn_desc = document.getElementById('scnDesc').value;
    currentBoard.consistency_layer.prp_desc = document.getElementById('prpDesc').value;
    currentBoard.consistency_layer.film_stock = document.getElementById('filmStock').value;
    (currentBoard.shots || []).forEach((s, idx) => {
      const el = document.getElementById('shotScript_' + idx);
      if (el) s.script_text = el.value;
    });
  }

  function isPresetUnmodified() {
    const preset = presetBoards[currentTemplateKey];
    if (!preset || !currentBoard) return false;
    if ((currentBoard.logline || '').trim() !== (preset.logline || '').trim()) return false;
    const clA = currentBoard.consistency_layer || {};
    const clB = preset.consistency_layer || {};
    for (const k of ['chr_desc', 'scn_desc', 'prp_desc', 'film_stock']) {
      if ((clA[k] || '').trim() !== (clB[k] || '').trim()) return false;
    }
    const sA = currentBoard.shots || [];
    const sB = preset.shots || [];
    if (sA.length !== sB.length || !sA.length) return false;
    for (let i = 0; i < sA.length; i++) {
      if (!sA[i].image_url) return false;
      if ((sA[i].script_text || '').trim() !== (sB[i].script_text || '').trim()) return false;
      if (Number(sA[i].selected_option_index || 0) !== Number(sB[i].selected_option_index || 0)) return false;
    }
    return true;
  }

  function loadTemplate(key) {
    currentTemplateKey = key;
    const tpl = presetBoards[key];
    if (!tpl) {
      showToast('正在加载预设工程...');
      return;
    }
    renderBoardUI(cloneObj(tpl));
    showToast(`✅ 已载入预设工程《${tpl.title}》（含 8×H100 实渲分镜图）`);
  }

  function switchTab(tab) {
    document.getElementById('viewDirector').style.display = tab === 'director' ? 'block' : 'none';
    document.getElementById('viewIndex').style.display = tab === 'index' ? 'block' : 'none';
    document.getElementById('tabBtnDirector').className = 'tab-btn' + (tab === 'director' ? ' active' : '');
    document.getElementById('tabBtnIndex').className = 'tab-btn' + (tab === 'index' ? ' active' : '');
    if (tab === 'index') triggerSearch();
  }

  function selectCameraOption(shotIdx, optIdx) {
    if (!currentBoard || !currentBoard.shots[shotIdx]) return;
    syncBoardFromInputs();
    const shot = currentBoard.shots[shotIdx];
    shot.selected_option_index = optIdx;
    shot.selected_option = shot.options[optIdx];
    shot.selected_option.prompt_img2img_ref = compileConsistentShotPrompt(
      currentBoard.consistency_layer,
      shot,
      shot.selected_option,
      true
    );
    shot.selected_option.prompt_lpa_dual = compileLpaDualPrompt(
      currentBoard.consistency_layer,
      currentBoard.shots[0].script_text || '',
      shot,
      shot.selected_option
    );
    renderBoardUI(currentBoard);
    showToast(`已切换第 ${shot.shot_no} 镜为「${shot.selected_option.option_tag}」，点击「🎯 单镜靶向重绘」获取新机位提示词！`);
  }

  function planStoryboard() {
    const t0 = performance.now();
    syncBoardFromInputs();
    const storyText = (document.getElementById('projStory').value || '').trim();
    const titleText = (document.getElementById('projTitle').value || '').trim() || '未命名 Story2Board 分镜项目';
    const cl = currentBoard && currentBoard.consistency_layer
      ? cloneObj(currentBoard.consistency_layer)
      : cloneObj((presetBoards[currentTemplateKey] || {}).consistency_layer || {});

    const preset = presetBoards[currentTemplateKey];
    const keepPresetMedia = preset && storyText === (preset.logline || '').trim() && currentBoard && currentBoard.shots && currentBoard.shots.length;

    const beats = parseFreeformStoryToBeats(storyText);
    const refAnchorText = beats[0] ? beats[0].script_text : storyText;

    const plannedShots = beats.map((beat, idx) => {
      let hits = searchLocalShots({
        query: beat.search_keywords || beat.script_text.slice(0, 12),
        scale: beat.preferred_scale,
        limit: 8,
      }).results;

      if (hits.length < 3) {
        const more = searchLocalShots({
          query: beat.preferred_emotion || '光影',
          limit: 8,
        }).results;
        const seen = new Set(hits.map((h) => h.shot_id));
        for (const mh of more) {
          if (!seen.has(mh.shot_id)) {
            hits.push(mh);
            seen.add(mh.shot_id);
          }
        }
      }

      const options = CAMERA_GRAMMAR_ALTERNATIVES.map((grammar, optIdx) => {
        const ref = hits.length ? hits[optIdx % hits.length] : {};
        const optScale = grammar.scale_override || ref.shot_scale || beat.preferred_scale || '中景';
        const optAngle = grammar.angle_override || ref.camera_angle || beat.preferred_angle || '平视';
        const optMove = grammar.move_override || ref.camera_movement || '固定';
        const optLens = ref.lens_type || (optScale.includes('近') || optScale.includes('特写') ? '长焦' : '标准');
        const optDof = ref.dof || (optScale.includes('近') || optScale.includes('特写') ? '浅景深' : '深景深');
        const optLight = ref.lighting || '实景冷暖戏剧光';
        const optComp = ref.composition || '三分法与框中框';
        const refTitle = ref.film_title_zh || '花样年华';
        const refYear = ref.year || 2000;
        const refDir = ref.director || '王家卫';
        const refDp = ref.dp || '杜可风';
        const refNote = ref.director_rationale || '利用空间遮挡与光比反差外化人物内心的孤独与克制。';
        const refPal = ref.palette || cl.palette || ['#141c1a', '#264038', '#6e5a2a', '#c88a3e', '#e8d5b5'];

        const optObj = {
          option_index: optIdx,
          option_tag: grammar.option_tag,
          ref_shot_id: ref.shot_id || `YS-0001-0${optIdx + 1}`,
          film_title_zh: refTitle,
          film_title_en: '',
          year: refYear,
          director: refDir,
          dp: refDp,
          is_top250: true,
          shot_scale: optScale,
          camera_angle: optAngle,
          camera_movement: optMove,
          lens_type: optLens,
          dof: optDof,
          lighting: optLight,
          composition: optComp,
          palette: refPal,
          director_rationale: `${grammar.rationale_prefix}参考《${refTitle}》（${refYear}，导演：${refDir} / 摄影：${refDp}）——${refNote}`,
        };
        optObj.prompt_t2i = compileConsistentShotPrompt(cl, beat, optObj, false);
        optObj.prompt_img2img_ref = compileConsistentShotPrompt(cl, beat, optObj, true);
        optObj.prompt_lpa_dual = compileLpaDualPrompt(cl, refAnchorText, beat, optObj);
        return optObj;
      });

      return {
        shot_no: beat.beat_no,
        shot_id: `S2B-SHOT-${String(beat.beat_no).padStart(2, '0')}`,
        beat_title: beat.beat_title,
        script_text: beat.script_text,
        dialogue: beat.dialogue,
        duration_sec: beat.duration_sec,
        selected_option_index: 0,
        selected_option: options[0],
        options,
        image_url: keepPresetMedia && preset.shots[idx] ? preset.shots[idx].image_url : '',
      };
    });

    const elapsedMs = Number((performance.now() - t0).toFixed(2));
    const newBoard = {
      title: titleText,
      logline: storyText,
      consistency_layer: cl,
      shots: plannedShots,
      planning_elapsed_ms: elapsedMs,
      anchor_image_url: keepPresetMedia ? preset.anchor_image_url : '',
      total_render_sec: keepPresetMedia ? preset.total_render_sec : undefined,
    };
    renderBoardUI(newBoard);
    showToast(`✅ AI 副导演拆镜与配镜完成（耗时 ${elapsedMs} ms）！`);
  }

  function openPromptPackModal(mode, focusShotNo) {
    syncBoardFromInputs();
    if (!currentBoard) return;
    const cl = currentBoard.consistency_layer || {};
    const anchorPrompt = compileAnchorPrompt(cl);
    const isLpa = mode === 'lpa_dual_panel';
    const shots = focusShotNo != null
      ? (currentBoard.shots || []).filter((s) => Number(s.shot_no) === Number(focusShotNo))
      : (currentBoard.shots || []);

    const linesForCopy = [];
    const blocksHtml = [];

    blocksHtml.push(`
      <div style="background:rgba(30,58,138,0.28); border-left:4px solid #3b82f6; padding:12px 16px; border-radius:8px; margin-bottom:16px; font-size:18px;">
        <strong>说明：</strong>为严守内网算力安全隔离，公网版自动为您编译好 100% 正向物理锁脸提示词（支持直接粘贴至 ComfyUI / 本机工作台一键调度 8×H100 出图）。
      </div>
    `);

    const modeTitle = isLpa
      ? '🧬 论文原版 LPA+RAVM 上下双联锁脸提示词包'
      : (focusShotNo != null ? `🎯 第 ${focusShotNo} 镜靶向重绘提示词包（锁定母图）` : '⚡ 剧组母图锁脸 (<image1>) 全套执行提示词包');
    document.getElementById('modalTitle').textContent = modeTitle;

    if (!isLpa) {
      linesForCopy.push(`【Step 1 · 剧组固定资产母图提示词 (panel_00_anchor)】\n${anchorPrompt}`);
      blocksHtml.push(`
        <div style="margin-bottom:14px;">
          <div style="font-weight:800; color:#93c5fd; margin-bottom:6px;">Step 1 · 剧组固定资产母图 (Anchor Sheet · Qwen-Image-2.1 文生图)</div>
          <div class="prompt-pre">${escHtml(anchorPrompt)}</div>
        </div>
      `);
    }

    shots.forEach((s) => {
      const opt = s.selected_option || (s.options || [])[s.selected_option_index || 0] || {};
      const pText = isLpa
        ? (opt.prompt_lpa_dual || compileLpaDualPrompt(cl, (currentBoard.shots[0] || {}).script_text || '', s, opt))
        : (opt.prompt_img2img_ref || compileConsistentShotPrompt(cl, s, opt, true));
      linesForCopy.push(`【${s.shot_id} · ${s.beat_title} · ${opt.shot_scale} / ${opt.camera_angle}】\n${pText}`);
      blocksHtml.push(`
        <div style="margin-bottom:14px;">
          <div style="font-weight:800; color:#fde68a; margin-bottom:6px;">
            ${escHtml(s.shot_id)} · ${escHtml(s.beat_title)}（${escHtml(opt.option_tag)} · ${escHtml(opt.shot_scale)}/${escHtml(opt.camera_angle)} · 致敬《${escHtml(opt.film_title_zh)}》）
          </div>
          <div class="prompt-pre">${escHtml(pText)}</div>
        </div>
      `);
    });

    modalCopyText = linesForCopy.join('\n\n');
    document.getElementById('modalCopyBtn').style.display = 'inline-flex';
    document.getElementById('modalBody').innerHTML = blocksHtml.join('');
    document.getElementById('promptModal').classList.add('open');
  }

  function closePromptModal() {
    document.getElementById('promptModal').classList.remove('open');
  }

  async function copyModalPromptText() {
    if (!modalCopyText) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(modalCopyText);
        showToast('✅ 已将全套锁脸提示词复制到剪贴板！');
        return;
      }
    } catch {}
    const ta = document.createElement('textarea');
    ta.value = modalCopyText;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('✅ 已将全套锁脸提示词复制到剪贴板！');
  }

  function renderStoryboard(mode = 'consistency_ref_lock') {
    syncBoardFromInputs();
    if (isPresetUnmodified() && mode === 'consistency_ref_lock') {
      showToast(`✅ 已载入金泰 8×H100 实渲成片（共 ${(currentBoard.shots || []).length} 镜，耗时 ${currentBoard.total_render_sec || 12.78} 秒）！`);
      return;
    }
    if (isPresetUnmodified() && currentTemplateKey === 'tang_chang_an_envoy' && mode === 'lpa_dual_panel') {
      showToast(`✅ 当前盛唐古装分镜即为金泰 8×H100 原生 LPA+RAVM 实渲成片（耗时 ${currentBoard.total_render_sec || 12.78} 秒）！`);
      return;
    }
    openPromptPackModal(mode, null);
  }

  function reviseSingleShot(shotNo, shotIdx) {
    syncBoardFromInputs();
    const shot = currentBoard && currentBoard.shots ? currentBoard.shots[shotIdx] : null;
    if (!shot) return;
    const opt = shot.selected_option || (shot.options || [])[shot.selected_option_index || 0] || {};
    opt.prompt_t2i = compileConsistentShotPrompt(currentBoard.consistency_layer, shot, opt, false);
    opt.prompt_img2img_ref = compileConsistentShotPrompt(currentBoard.consistency_layer, shot, opt, true);
    opt.prompt_lpa_dual = compileLpaDualPrompt(currentBoard.consistency_layer, (currentBoard.shots[0] || {}).script_text || '', shot, opt);
    shot.selected_option = opt;
    openPromptPackModal('consistency_ref_lock', shotNo);
  }

  function resolveAbsUrl(relOrUrl) {
    if (!relOrUrl) return '';
    try {
      return new URL(relOrUrl, location.href).href;
    } catch {
      return relOrUrl;
    }
  }

  function buildCallsheetHtmlString(board) {
    const cl = board.consistency_layer || {};
    const shots = board.shots || [];
    const nowStr = new Date().toLocaleString('zh-CN', { hour12: false });
    const anchorAbs = resolveAbsUrl(board.anchor_image_url);
    const palette = cl.palette || ['#0d1b2a', '#1b4965', '#5fa8d3', '#e09f3e', '#9e2a2b'];
    const swatchesHtml = palette.slice(0, 5).map((c) =>
      `<span class="swatch" style="background:${escHtml(c)};">${escHtml(c)}</span>`
    ).join('');

    const shotsHtml = shots.map((s) => {
      const opt = s.selected_option || (s.options || [])[s.selected_option_index || 0] || {};
      const imgAbs = resolveAbsUrl(s.image_url);
      const imgBlock = imgAbs
        ? `<div class="shot-img-wrap"><img src="${escHtml(imgAbs)}" alt="Shot ${escHtml(s.shot_no)}" /></div>`
        : `<div class="shot-img-placeholder">分镜画面待 ComfyUI 渲染（已附锁脸提示词）</div>`;
      const altList = (s.options || []).map((ao, idx) => {
        const mark = idx === (s.selected_option_index || 0) ? '【当前采用】' : `【备选方案 ${idx + 1}】`;
        return `<li><strong>${escHtml(mark + (ao.option_tag || ''))}</strong>：${escHtml(ao.shot_scale)} · ${escHtml(ao.camera_angle)} · 运镜：${escHtml(ao.camera_movement)}（致敬《${escHtml(ao.film_title_zh)}》${escHtml(ao.year)} · ${escHtml(ao.director)}/${escHtml(ao.dp)}）</li>`;
      }).join('');

      return `
        <div class="shot-block">
          <div class="shot-header">
            <span class="shot-badge">${escHtml(s.shot_id)}</span>
            <span class="shot-title">${escHtml(s.beat_title)}（时长：${escHtml(s.duration_sec || 4.0)}s）</span>
          </div>
          ${imgBlock}
          <table class="data-table">
            <colgroup>
              <col style="width: 24%;" />
              <col style="width: 38%;" />
              <col style="width: 38%;" />
            </colgroup>
            <thead>
              <tr><th>场记维度</th><th>当前锁定机位与摄影参数</th><th>对标影史名片与色彩母题</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>剧本动作与台词</strong></td>
                <td>${escHtml(s.script_text)}</td>
                <td>台词：${escHtml(s.dialogue || '（纯视觉叙事无台词）')}</td>
              </tr>
              <tr>
                <td><strong>景别 / 机位 / 运镜</strong></td>
                <td>景别：<strong>${escHtml(opt.shot_scale)}</strong> ｜ 角度：<strong>${escHtml(opt.camera_angle)}</strong><br/>运镜：<strong>${escHtml(opt.camera_movement)}</strong> ｜ 焦段：${escHtml(opt.lens_type)}（${escHtml(opt.dof)}）</td>
                <td>参考影片：<strong>《${escHtml(opt.film_title_zh)}》</strong>（${escHtml(opt.year)}）<br/>导演：${escHtml(opt.director)} ｜ 摄影：${escHtml(opt.dp)}（${escHtml(opt.ref_shot_id)}）</td>
              </tr>
              <tr>
                <td><strong>布光与构图</strong></td>
                <td>布光：${escHtml(opt.lighting)}</td>
                <td>构图：${escHtml(opt.composition)}</td>
              </tr>
            </tbody>
          </table>
          <div class="callout-box">
            <div class="callout-title">AI 副导演运镜动机解析（Why This Camera Choice）</div>
            <p>${escHtml(opt.director_rationale)}</p>
          </div>
          <div class="alt-box">
            <div class="alt-title">同场 3 套备选机位方案对比：</div>
            <ul>${altList}</ul>
          </div>
        </div>
      `;
    }).join('');

    const anchorCardHtml = anchorAbs ? `
      <div class="anchor-card">
        <div class="anchor-title">剧组固定资产母图（Consistency Layer Master Anchor · 跨镜身份与光影基准）</div>
        <div class="shot-img-wrap"><img src="${escHtml(anchorAbs)}" alt="Consistency Layer Anchor" /></div>
      </div>
    ` : '';

    const st = (liveTunnelData && liveTunnelData.ok && liveTunnelData.stats)
      ? liveTunnelData.stats
      : indexStats;
    const totalWanStr = (Number(st.total_visual_library_shots || 3266777) / 10000).toFixed(1);
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${escHtml(board.title || 'Story2Board 电影分镜')} - 20pt 场记单</title>
<style>
  @page { size: A4 portrait; margin: 16mm 15mm 18mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 20pt; line-height: 1.72; color: #111827; background: #ffffff; margin: 0; padding: 18px 24px 40px 24px; word-wrap: break-word; overflow-wrap: break-word; }
  .print-bar { position: sticky; top: 0; z-index: 99; background: #0f172a; color: #fff; padding: 12px 18px; border-radius: 10px; margin-bottom: 18px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; font-size: 16pt; }
  .print-btn { background: #d97706; color: #fff; border: none; padding: 10px 22px; border-radius: 8px; font-size: 16pt; font-weight: 700; cursor: pointer; }
  @media print { .no-print { display: none !important; } body { padding: 0; } }
  h1 { font-size: 28pt; line-height: 1.35; color: #0f172a; margin: 0 0 10px 0; padding-bottom: 10px; border-bottom: 4px solid #1e40af; }
  h2 { font-size: 23pt; line-height: 1.4; color: #1e3a8a; margin: 22px 0 12px 0; padding-left: 12px; border-left: 6px solid #1e40af; break-after: avoid; }
  .meta-bar { font-size: 18.5pt; color: #334155; background: #f1f5f9; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; }
  .callout-box { background: #eff6ff; border-left: 5px solid #1e40af; padding: 14px 18px; border-radius: 6px; margin: 12px 0; break-inside: avoid; }
  .callout-title { font-weight: 700; color: #1e3a8a; margin-bottom: 6px; }
  .alt-box { background: #f8fafc; border: 1.5px solid #cbd5e1; padding: 12px 16px; border-radius: 6px; margin: 12px 0; font-size: 18.5pt; break-inside: avoid; }
  .alt-title { font-weight: 700; color: #0f172a; margin-bottom: 6px; }
  .alt-box ul { margin: 0; padding-left: 26px; }
  .data-table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 12px 0; font-size: 18.5pt; line-height: 1.55; }
  .data-table tr { break-inside: avoid; }
  .data-table th, .data-table td { border: 1.5px solid #94a3b8; padding: 10px 12px; vertical-align: top; text-align: left; }
  .data-table th { background: #1e293b; color: #ffffff; font-weight: 700; }
  .swatch { display: inline-block; padding: 3px 10px; margin-right: 8px; border-radius: 4px; color: #fff; font-size: 16pt; font-family: Consolas, monospace; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
  .anchor-card, .shot-block { border: 2px solid #cbd5e1; border-radius: 10px; padding: 16px; margin: 18px 0; background: #fff; }
  .anchor-title, .shot-header { font-size: 21pt; font-weight: 700; color: #0f172a; margin-bottom: 10px; break-after: avoid; }
  .shot-badge { display: inline-block; background: #1e40af; color: #fff; padding: 2px 12px; border-radius: 6px; margin-right: 10px; font-size: 18.5pt; }
  .shot-img-wrap { width: 100%; text-align: center; margin: 8px 0 12px 0; }
  .shot-img-wrap img { width: 100%; max-height: 300px; object-fit: cover; border-radius: 8px; border: 1.5px solid #64748b; }
  .shot-img-placeholder { width: 100%; height: 150px; background: #e2e8f0; color: #475569; display: flex; align-items: center; justify-content: center; border-radius: 8px; margin-bottom: 12px; }
</style>
</head>
<body>
  <div class="print-bar no-print">
    <span>📄 金泰 Story2Board · 20pt 适老大字版电影分镜场记单 (A4 打印直出 PDF)</span>
    <button class="print-btn" onclick="window.print()">🖨️ 一键打印 / 另存为 PDF</button>
  </div>
  <h1>${escHtml(board.title || 'Story2Board 电影分镜')} · 工业级分镜场记单 (Call Sheet)</h1>
  <div class="meta-bar">
    <strong>系统引擎：</strong>金泰 Story2Board · AI 副导演工作台（250 部影史名片 / ${escHtml(totalWanStr)} 万镜索引 + 8×H100 一致性渲染）<br/>
    <strong>生成时间：</strong>${escHtml(nowStr)} ｜ <strong>画幅规格：</strong>${escHtml(cl.aspect_ratio || '16:9')}
  </div>
  <h2>壹、故事梗概 (Logline)</h2>
  <div class="callout-box"><p>${escHtml(board.logline || '')}</p></div>
  <h2>贰、剧组固定资产图层 (Consistency Layer · 全片锁死不漂移)</h2>
  <table class="data-table">
    <colgroup><col style="width: 24%;" /><col style="width: 26%;" /><col style="width: 50%;" /></colgroup>
    <thead><tr><th>资产槽位</th><th>资产锁死代号</th><th>跨镜锚定视觉描述</th></tr></thead>
    <tbody>
      <tr><td><strong>主角锁死</strong></td><td>${escHtml(cl.chr_id || '@CHR')}</td><td>${escHtml(cl.chr_desc)}</td></tr>
      <tr><td><strong>场景锁死</strong></td><td>${escHtml(cl.scn_id || '@SCN')}</td><td>${escHtml(cl.scn_desc)}</td></tr>
      <tr><td><strong>核心道具</strong></td><td>${escHtml(cl.prp_id || '@PRP')}</td><td>${escHtml(cl.prp_desc)}</td></tr>
      <tr><td><strong>影调与色板</strong></td><td>${escHtml(cl.look_id || '@LOOK')}</td><td>${escHtml(cl.film_stock)}<br/>${swatchesHtml}</td></tr>
    </tbody>
  </table>
  ${anchorCardHtml}
  <h2>叁、逐镜分镜画面与 AI 副导演视听调度表</h2>
  ${shotsHtml}
</body>
</html>`;
  }

  function exportPdfCallSheet() {
    syncBoardFromInputs();
    if (!currentBoard) return;
    const htmlStr = buildCallsheetHtmlString(currentBoard);
    const blob = new Blob([htmlStr], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) {
      showToast('✅ 20pt 大字版分镜场记单已打开，点右上角即可「打印 / 另存为 PDF」！');
      return;
    }
    modalCopyText = '';
    document.getElementById('modalTitle').textContent = '📄 20pt 适老大字版分镜场记单已就绪';
    document.getElementById('modalCopyBtn').style.display = 'none';
    document.getElementById('modalBody').innerHTML = `
      <p style="font-size:19px;">当前浏览器拦截了自动弹窗，请点击下方按钮打开或保存场记单（内含一键打印转 PDF 按钮）：</p>
      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:16px;">
        <a class="btn btn-gold" href="${escHtml(url)}" target="_blank" style="text-decoration:none;">🌐 打开 20pt 大字版场记单预览</a>
        <a class="btn btn-emerald" href="${escHtml(url)}" download="Story2Board_分镜场记单_${escHtml(currentTemplateKey)}.html" style="text-decoration:none;">⬇️ 下载独立场记单 (.html)</a>
      </div>
    `;
    document.getElementById('promptModal').classList.add('open');
  }

  function quickSearch(q, top250Only, chipEl) {
    document.getElementById('globalSearchInput').value = q;
    document.getElementById('filterTop250').checked = top250Only;
    document.querySelectorAll('.chip-group .chip').forEach((c) => c.classList.remove('active'));
    if (chipEl) chipEl.classList.add('active');
    switchTab('index');
  }

  async function triggerSearch() {
    const q = document.getElementById('globalSearchInput').value.trim();
    const scale = document.getElementById('filterScale').value;
    const angle = document.getElementById('filterAngle').value;
    const move = document.getElementById('filterMove').value;
    const top250 = document.getElementById('filterTop250').checked ? '1' : '0';

    let data = null;
    let sourceLabel = '';

    if (liveTunnelData && liveTunnelData.ok) {
      try {
        const params = new URLSearchParams({ q, scale, angle, move, top250, limit: '24' });
        const base = tunnelBase ? tunnelBase.replace(/\/$/, '') : '';
        const r = await fetch(`${base}/__s2b_search?${params.toString()}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
        });
        if (r.ok) {
          const j = await r.json();
          if (j && j.ok) {
            data = j;
            sourceLabel = '实时直连全库 58,610 镜';
          }
        }
      } catch {}
    }

    if (!data) {
      data = searchLocalShots({ query: q, scale, angle, move, limit: 24 });
      sourceLabel = fullIndexLoaded ? '云端离线 Top-250 名片 10,675 镜' : '云端极速启动索引（后台加载全量中）';
    }

    document.getElementById('searchCountInfo').textContent =
      `检索耗时 ${data.elapsed_ms} ms ｜ 展示 ${data.count} 条大师母镜（${sourceLabel}）`;

    const grid = document.getElementById('indexResultsGrid');
    grid.innerHTML = '';
    if (!(data.results || []).length) {
      grid.innerHTML = `<div class="index-item" style="grid-column:1/-1; color:#cbd5e1;">未找到匹配的镜头，请尝试简化关键词或切换筛选条件。</div>`;
      return;
    }

    (data.results || []).forEach((r) => {
      const swatches = (r.palette || []).map((c) =>
        `<span class="swatch-dot" style="background:${escHtml(c)};" title="${escHtml(c)}"></span>`
      ).join('');
      const el = document.createElement('div');
      el.className = 'index-item';
      el.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px;">
          <div>
            <strong style="font-size:22px; color:#fff;">《${escHtml(r.film_title_zh)}》</strong>
            <span style="color:#94a3b8; font-size:18px;">(${escHtml(r.year)} · 导演：${escHtml(r.director)} / 摄影：${escHtml(r.dp)})</span>
          </div>
          ${r.is_top250 ? '<span class="tag-pill tag-top250">🏆 Top 250 名片</span>' : ''}
        </div>
        <div style="margin-bottom:10px;">
          <span class="tag-pill">景别：${escHtml(r.shot_scale)}</span>
          <span class="tag-pill">角度：${escHtml(r.camera_angle)}</span>
          <span class="tag-pill">运镜：${escHtml(r.camera_movement)}</span>
          <span class="tag-pill">焦段：${escHtml(r.lens_type)} (${escHtml(r.dof)})</span>
          <span class="tag-pill">布光：${escHtml(r.lighting)}</span>
        </div>
        <div class="rationale-box" style="margin-bottom:10px;">
          <strong>🎬 为什么这么运镜：</strong>${escHtml(r.director_rationale)}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>色板：${swatches}</div>
          <span style="font-size:16px; color:#64748b;">编号：${escHtml(r.shot_id)}</span>
        </div>
      `;
      grid.appendChild(el);
    });
  }

  async function bootstrap() {
    try {
      const [boardsResp, bootResp] = await Promise.all([
        fetch('./data/boards.json', { cache: 'no-cache' }),
        fetch('./data/top250_boot.json', { cache: 'no-cache' }),
      ]);
      if (boardsResp.ok) {
        presetBoards = await boardsResp.json();
        if (presetBoards[currentTemplateKey]) {
          renderBoardUI(cloneObj(presetBoards[currentTemplateKey]));
        }
      }
      if (bootResp.ok) {
        const bootJson = await bootResp.json();
        if (bootJson.stats) indexStats = bootJson.stats;
        top250Rows = decodeCompactTable(bootJson);
      }
    } catch (e) {
      console.error('Bootstrap error:', e);
    }

    updateHealthBanner();
    if (location.hash === '#index') {
      switchTab('index');
    }
    await discoverTunnel();
    if (document.getElementById('viewIndex').style.display === 'block' && liveTunnelData && liveTunnelData.ok) {
      triggerSearch();
    }

    // Background-load full 10,675 Top-250 shots via streaming gzip without blocking first paint
    try {
      let fullJson = null;
      const gzResp = await fetch('./data/top250_full.json.gz', { cache: 'default' });
      if (gzResp.ok) {
        const ab = await gzResp.arrayBuffer();
        const b = new Uint8Array(ab);
        if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
          const ds = new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));
          fullJson = await new Response(ds).json();
        } else {
          fullJson = JSON.parse(new TextDecoder('utf-8').decode(b));
        }
      } else {
        const fbResp = await fetch('./data/top250_full.json', { cache: 'default' });
        if (fbResp.ok) fullJson = await fbResp.json();
      }
      if (fullJson) {
        const decoded = decodeCompactTable(fullJson);
        if (decoded.length) {
          top250Rows = decoded;
          fullIndexLoaded = true;
          updateHealthBanner();
          if (document.getElementById('viewIndex').style.display === 'block') {
            triggerSearch();
          }
        }
      }
    } catch {}
  }

  window.switchTab = switchTab;
  window.loadTemplate = loadTemplate;
  window.selectCameraOption = selectCameraOption;
  window.planStoryboard = planStoryboard;
  window.renderStoryboard = renderStoryboard;
  window.reviseSingleShot = reviseSingleShot;
  window.exportPdfCallSheet = exportPdfCallSheet;
  window.quickSearch = quickSearch;
  window.triggerSearch = triggerSearch;
  window.openPromptPackModal = openPromptPackModal;
  window.closePromptModal = closePromptModal;
  window.copyModalPromptText = copyModalPromptText;

  window.addEventListener('hashchange', () => {
    if (location.hash === '#index') switchTab('index');
    else if (location.hash === '#director') switchTab('director');
  });
  window.addEventListener('DOMContentLoaded', bootstrap);
})();
