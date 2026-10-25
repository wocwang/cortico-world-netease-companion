/**
 * 设置页按用途折叠配置分组；实时状态页在打开期间每 2 秒读取一次 World 快照。
 * 宿主的顶部徽章只在开页或手动刷新时取一次。
 */
export default {
  panels: {
    'settings': {
      mount(ctx) {
        const ui = ctx.ui;
        const zh = String(ctx.language ?? 'zh').startsWith('zh');
        const text = {
          refresh: zh ? '刷新' : 'Refresh',
          autoSave: zh ? '修改后自动保存' : 'Auto-save',
          restart: zh ? '重启 World' : 'Restart World',
          on: zh ? '开启' : 'On',
          off: zh ? '关闭' : 'Off',
          saving: zh ? '正在保存…' : 'Saving…',
          saved: zh ? '已保存' : 'Saved',
          empty: zh ? '没有可显示的配置项' : 'No settings to show',
          invalidNumber: title => zh ? `「${title}」不是有效数字，未保存` : `"${title}" is not a valid number; not saved`,
          outOfRange: (title, min, max) => zh
            ? `「${title}」需在 ${min}–${max} 之间，未保存`
            : `"${title}" must be between ${min} and ${max}; not saved`,
          invalidRegex: zh ? '正则表达式无效，未保存' : 'Invalid regular expression; not saved',
          saveFailed: msg => zh ? `保存失败：${msg}` : `Save failed: ${msg}`,
          loadFailed: msg => zh ? `读取配置失败：${msg}` : `Could not read settings: ${msg}`,
        };

        const bar = ui.rowbar();
        const status = ui.msgline('');
        const host = ui.h('div');
        bar.append(
          ui.pill(text.autoSave, 'plain'),
          ui.h('span', 'grow'),
          ui.button(text.refresh, { size: 'sm', onClick: () => void load() }),
        );
        ctx.root.append(bar, host, status);

        let groups = [];

        const valueOf = (group, key) => {
          const reader = group.readers.find(item => item.key === key);
          return reader ? reader.read() : undefined;
        };
        const onOff = value => value === true ? text.on : value === false ? text.off : '—';
        const summary = group => {
          const get = key => valueOf(group, key);
          switch (group.kind) {
            case 'commentary':
              return zh
                ? `评论 ${onOff(get('commentary'))} · 稳定 ${get('settleSeconds') ?? '—'} 秒 · 间隔 ${get('cooldownSeconds') ?? '—'} 秒 · ${get('maxCommentChars') ?? '—'} 字 · ${get('commentExcerpts') ?? '—'} 条`
                : `Comments ${onOff(get('commentary'))} · settle ${get('settleSeconds') ?? '—'}s · gap ${get('cooldownSeconds') ?? '—'}s · ${get('maxCommentChars') ?? '—'} chars · ${get('commentExcerpts') ?? '—'} excerpts`;
            case 'context':
              return zh
                ? `评论区 ${onOff(get('commentReference'))} · 歌手 ${onOff(get('artistContext'))} · 歌曲 ${onOff(get('songContext'))}`
                : `Comments ${onOff(get('commentReference'))} · artist ${onOff(get('artistContext'))} · song ${onOff(get('songContext'))}`;
            case 'lyrics':
              return zh
                ? `歌词 ${onOff(get('lyricsContext'))} · 翻译 ${onOff(get('lyricsTranslation'))} · ${get('lyricsLines') ?? '—'} 行`
                : `Lyrics ${onOff(get('lyricsContext'))} · translation ${onOff(get('lyricsTranslation'))} · ${get('lyricsLines') ?? '—'} lines`;
            case 'listening':
              return zh
                ? `收录 ${get('listeningTrackLimit') ?? '—'} 首 / ${get('listeningArtistLimit') ?? '—'} 位 · 显示 ${get('listeningRankTrackRange') ?? '—'} / ${get('listeningRankArtistRange') ?? '—'}`
                : `Store ${get('listeningTrackLimit') ?? '—'} / ${get('listeningArtistLimit') ?? '—'} · show ${get('listeningRankTrackRange') ?? '—'} / ${get('listeningRankArtistRange') ?? '—'}`;
            case 'reader':
              return zh
                ? `窗口降级 ${onOff(get('windowFallback'))} · SMTC 正则 ${get('sessionPattern') ? '已设置' : '—'}`
                : `Window fallback ${onOff(get('windowFallback'))} · SMTC pattern ${get('sessionPattern') ? 'set' : '—'}`;
            default:
              return `${group.fields.length} ${zh ? '项' : 'fields'}`;
          }
        };

        const invalid = message => {
          status.classList.add('bad');
          status.textContent = message;
        };

        let timers = new Map();
        const queueSave = group => {
          group.sheet.note.textContent = summary(group);
          timers.get(group.id)?.dispose();
          timers.set(group.id, ctx.timeout(() => {
            timers.delete(group.id);
            void save(group);
          }, 400));
        };

        const save = async group => {
          if (ctx.signal.aborted) return;
          const values = {};
          for (const reader of group.readers) {
            if (!reader.read) continue;
            const value = reader.read();
            if (value === undefined) {
              invalid(text.invalidNumber(reader.title));
              return;
            }
            if ((reader.type === 'integer' || reader.type === 'number')
              && typeof value === 'number') {
              if (reader.minimum != null && value < reader.minimum) {
                invalid(text.outOfRange(reader.title, reader.minimum, reader.maximum));
                return;
              }
              if (reader.maximum != null && value > reader.maximum) {
                invalid(text.outOfRange(reader.title, reader.minimum, reader.maximum));
                return;
              }
            }
            if ((reader.key === 'sessionPattern' || reader.key === 'windowFallbackProcess')
              && typeof value === 'string') {
              try { new RegExp(value); }
              catch { invalid(text.invalidRegex); return; }
            }
            values[reader.key] = value;
          }
          try {
            status.classList.remove('bad');
            status.textContent = text.saving;
            await ctx.invoke('save', [values]);
            if (ctx.signal.aborted) return;
            status.textContent = text.saved;
            group.sheet.note.textContent = summary(group);
          } catch (e) {
            if (e && e.name === 'AbortError') return;
            invalid(text.saveFailed(e instanceof Error ? e.message : String(e)));
          }
        };

        const control = (group, field) => {
          const changed = () => queueSave(group);
          if (field.type === 'boolean') {
            const box = ui.checkbox(text.on, { checked: field.value === true, onChange: changed });
            return { node: box.el, read: () => box.checked };
          }
          if (field.type === 'integer' || field.type === 'number') {
            const input = ui.input({
              type: 'number',
              value: field.value == null ? '' : String(field.value),
              onChange: changed,
            });
            if (field.minimum != null) input.min = String(field.minimum);
            if (field.maximum != null) input.max = String(field.maximum);
            input.step = field.type === 'integer' ? '1' : 'any';
            return {
              node: input,
              read: () => {
                const raw = input.value.trim();
                if (raw === '') return undefined;
                const value = Number(raw);
                if (!Number.isFinite(value)) return undefined;
                return field.type === 'integer' ? Math.floor(value) : value;
              },
            };
          }
          if (field.type === 'string') {
            const input = ui.input({
              type: 'text',
              value: field.value == null ? '' : String(field.value),
              cls: field.key === 'sessionPattern' || field.key === 'windowFallbackProcess' ? 'mono' : undefined,
              onChange: changed,
            });
            return { node: input, read: () => input.value };
          }
          return { node: ui.h('span', 'tdesc', String(field.value ?? '')), read: null };
        };

        const load = async () => {
          for (const timer of timers.values()) timer.dispose();
          timers.clear();
          status.classList.remove('bad');
          status.textContent = '';
          let payload;
          try {
            payload = await ctx.invoke('read');
          } catch (e) {
            invalid(text.loadFailed(e instanceof Error ? e.message : String(e)));
            return;
          }
          if (ctx.signal.aborted) return;
          groups = (Array.isArray(payload?.groups) ? payload.groups : []).map(group => ({ ...group, readers: [] }));
          host.replaceChildren();
          for (const group of groups) {
            const sheet = ui.foldSheet(`settings-${group.kind}`, {
              title: group.title, desc: group.description || undefined,
            });
            group.sheet = sheet;
            for (const field of group.fields) {
              const row = ui.h('div', 'trow');
              const label = ui.h('span', 'tlabel', field.title);
              if (!field.hot) label.appendChild(ui.h('span', 'ttag', text.restart));
              const fieldWrap = ui.h('div', 'tfield');
              const built = control(group, field);
              fieldWrap.appendChild(built.node);
              row.append(label, fieldWrap, ui.h('span', 'tdesc', field.description || ''));
              sheet.body.appendChild(row);
              if (built.read) {
                group.readers.push({
                  key: field.key, title: field.title, type: field.type,
                  minimum: field.minimum, maximum: field.maximum, read: built.read,
                });
              }
            }
            sheet.note.textContent = summary(group);
            host.appendChild(sheet.el);
          }
          if (!groups.length) host.appendChild(ui.placeholder(text.empty));
        };

        void load();
      },
    },
    'live-status': {
      mount(ctx) {
        const ui = ctx.ui;
        const zh = String(ctx.language ?? 'zh').startsWith('zh');
        const table = ui.h('div');
        const note = ui.msgline('');
        ctx.root.append(table, note);

        const draw = (s) => {
          table.replaceChildren(ui.kv([
            { k: zh ? '读取状态' : 'Reader', v: s.reading },
            { k: zh ? '当前曲目' : 'Track', v: s.track },
            { k: zh ? '播放状态' : 'Playback', v: s.playback },
            { k: zh ? '来源' : 'Source', v: s.method || '-' },
            { k: zh ? '陪听' : 'Commentary', v: s.commentary },
            { k: zh ? '评论区' : 'Comments', v: s.comment },
            { k: zh ? '歌手资料' : 'Artist', v: s.artist },
            { k: zh ? '歌曲背景' : 'Song', v: s.song || '未启用' },
            { k: zh ? '歌词' : 'Lyrics', v: s.lyrics || '未启用' },
            { k: zh ? '偏好记忆' : 'Preferences', v: s.preferences || '未启用' },
            { k: zh ? '互动频率' : 'Cadence', v: s.interaction || '未启用' },
            { k: zh ? '听歌记忆' : 'Listening', v: s.listening || '未启用' },
            { k: zh ? '本次已请求评论' : 'Requests', v: String(s.requests) },
          ]));
          note.textContent = s.observedAt
            ? (zh ? `最近观测 ${new Date(s.observedAt).toLocaleTimeString()}` : `Observed ${new Date(s.observedAt).toLocaleTimeString()}`)
            : (zh ? '尚未观测到播放状态' : 'No observation yet');
          note.classList.remove('bad');
        };

        const tick = async () => {
          try {
            draw(await ctx.invoke('snapshot'));
          } catch (e) {
            note.classList.add('bad');
            note.textContent = e instanceof Error ? e.message : String(e);
          }
        };

        void tick();
        ctx.interval(() => void tick(), 2000);
      },
    },
    'listening-ranking': {
      mount(ctx) {
        const ui = ctx.ui;
        const zh = String(ctx.language ?? 'zh').startsWith('zh');
        let view = 'tracks';
        let last = null;
        let draw = () => {};
        const statsHost = ui.h('div');
        const note = ui.msgline('');
        const tabs = ui.segmented([
          { value: 'tracks', label: zh ? '歌曲榜' : 'Songs' },
          { value: 'artists', label: zh ? '歌手榜' : 'Artists' },
        ], {
          value: 'tracks', size: 'sm',
          onSelect: value => { view = value; if (last) draw(last); },
        });
        const bar = ui.rowbar();
        bar.append(tabs.el, ui.chip(zh ? '按播放次数' : 'By plays', 'plain'));

        const songPodium = ui.statgrid();
        const artistPodium = ui.statgrid();
        const songs = ui.table({
          head: zh ? ['#', '歌曲', '歌手', '播放', '最近'] : ['#', 'Song', 'Artist', 'Plays', 'Last'],
          maxHeight: '38vh',
        });
        const artists = ui.table({
          head: zh ? ['#', '歌手', '播放', '最近'] : ['#', 'Artist', 'Plays', 'Last'],
          maxHeight: '30vh',
        });
        const songSection = ui.section(zh ? '常听歌曲' : 'Top songs', zh ? '前三名单独展示，其余按名次排列' : 'Top 3 highlighted, the rest ranked');
        songSection.append(songPodium, songs.el);
        const artistSection = ui.section(zh ? '常听歌手' : 'Top artists', zh ? '前三名单独展示，其余按名次排列' : 'Top 3 highlighted, the rest ranked');
        artistSection.append(artistPodium, artists.el);
        ctx.root.append(statsHost, bar, songSection, artistSection, note);

        const date = (v) => {
          const d = new Date(v);
          return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString();
        };
        const podium = (host, items, title, desc) => {
          host.replaceChildren();
          for (const item of items.slice(0, 3)) {
            const card = ui.sheet({ title: `#${item.rank} ${title(item)}`, desc: desc(item) });
            card.body.append(ui.stat({
              k: zh ? '播放' : 'Plays', v: item.count, unit: zh ? '次' : 'plays', accent: item.rank === 1,
            }));
            host.append(card.el);
          }
        };
        const fill = (table, items, row, empty) => {
          table.clear(items.length === 0 ? empty : items.length <= 3
            ? (zh ? '没有更多名次' : 'No more ranks')
            : (zh ? '前三名已在上方展示' : 'Top 3 shown above'));
          const max = items[0]?.count || 1;
          for (const item of items.slice(3)) {
            const rank = ui.chip(String(item.rank), 'plain');
            const plays = ui.progress({
              value: item.count, max, tone: 'plain',
              format: value => `${value} ${zh ? '次' : 'plays'}`,
            });
            table.addRow([rank, ...row(item, plays.el)]);
          }
        };
        draw = (s) => {
          last = s;
          const limits = s.limits || { tracks: 0, artists: 0, rankTracks: 0, rankArtists: 0 };
          statsHost.replaceChildren(ui.statgrid([
            { k: zh ? '总播放' : 'Total plays', v: s.totalPlays ?? 0, unit: zh ? '次' : 'plays', accent: true },
            { k: zh ? '收录歌曲' : 'Stored songs', v: s.storedTracks ?? 0, unit: zh ? '首' : 'tracks' },
            { k: zh ? '收录歌手' : 'Stored artists', v: s.storedArtists ?? 0, unit: zh ? '位' : 'artists' },
            { k: zh ? '显示范围' : 'Display range', v: limits.rankTracks, unit: zh ? `首 / ${limits.rankArtists} 位` : `songs / ${limits.rankArtists} artists` },
          ]));
          songSection.hidden = view !== 'tracks';
          artistSection.hidden = view !== 'artists';
          const tracks = s.tracks || [];
          const artistList = s.artists || [];
          podium(songPodium, tracks, t => t.title, t => `${t.artist || '-'} · ${date(t.lastAt)}`);
          podium(artistPodium, artistList, a => a.name, a => date(a.lastAt));
          fill(songs, tracks, (t, plays) => [t.title, t.artist || '-', plays, date(t.lastAt)], zh ? '还没有听歌记录' : 'No listening history yet');
          fill(artists, artistList, (a, plays) => [a.name, plays, date(a.lastAt)], zh ? '还没有歌手记录' : 'No artist history yet');
          if (s.status === 'unavailable') {
            note.classList.add('bad');
            note.textContent = zh ? '听歌记忆未启用' : 'Listening memory unavailable';
            return;
          }
          note.classList.remove('bad');
          note.textContent = zh
            ? `共 ${s.totalPlays ?? 0} 次播放 · 显示前 ${limits.rankTracks} 首 / 前 ${limits.rankArtists} 位 · 更新于 ${new Date().toLocaleTimeString()}`
            : `${s.totalPlays ?? 0} plays · top ${limits.rankTracks} songs / ${limits.rankArtists} artists · updated ${new Date().toLocaleTimeString()}`;
        };
        const tick = async () => {
          try {
            draw(await ctx.invoke('snapshot'));
          } catch (e) {
            note.classList.add('bad');
            note.textContent = e instanceof Error ? e.message : String(e);
          }
        };
        void tick();
        ctx.interval(() => void tick(), 5000);
      },
    },
  },
};
