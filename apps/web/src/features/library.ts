/**
 * 曲库规模。首页的数据组和大厅的玩法说明都引它，所以它只能有一处。
 *
 * 两个数都是构建产物的实际计数，不是估计：
 *   songs = assets/manifest.public.json → songs.length
 *   clips = assets/slices 下 .opus 的文件数
 *
 * 曲库变动后重新求值：
 *   node -e "console.log(require('./assets/manifest.public.json').songs.length)"
 *   find assets/slices -type f -name '*.opus' | wc -l
 *
 * 这两处原本各自写死「234 首」，是提交 a02a215（移除误入曲库的人声版
 * リフレクトサイン）之后没同步的旧值 —— 同一个事实抄了两份，就会以两倍速度过期。
 *
 * 没有走接口拿这个数：为一个说明性数字给首屏加一次网络往返不划算，
 * 代价是它是编译期常量，需要人工同步 —— 所以求值命令留在上面。
 */
export const LIBRARY = { songs: 243, clips: 1458 } as const
