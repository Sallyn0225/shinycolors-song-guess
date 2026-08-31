import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { ambience } from './ambience'
import App from './App'
import { audio } from './audio'
import './index.css'
import { loadAudioPrefs } from './prefs'

// 音量偏好必须在**任何**界面挂载之前就进引擎，而不是等首页的控件挂载时才读：
// 刷新后接回 1v1 对局走的是恢复路径，那条路上根本不经过首页，没人会去读它。
const prefs = loadAudioPrefs()
audio.setVolume(prefs.level, prefs.muted)
// 旁路那条链各记各的：它不受滑杆管，但静音和 BGM 开关都要在第一声之前就位。
// `audio.ts` 是禁区，不在那边加订阅机制，改由改动这两个值的地方显式同步 ——
// 全项目只有这里和 VolumeControl.commit() 两处。
ambience.setMuted(prefs.muted)
ambience.setBgmOn(prefs.bgmOn)

const root = document.getElementById('root')
if (!root) throw new Error('#root 不存在')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
