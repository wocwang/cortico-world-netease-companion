/**
 * 实时状态面板。宿主的顶部徽章只在开页或手动刷新时取一次，这里在面板打开期间
 * 每 2 秒读取一次 World 快照，让读取状态、曲目、评论区与歌手资料保持最新。
 */
export default {
  panels: {
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
