/* @refresh reload */
import { render } from 'solid-js/web'
import App from './App'
import './index.css'
import '@xterm/xterm/css/xterm.css'
import { ensureWebBridge } from './lib/webBridge'

ensureWebBridge()

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

render(() => <App />, root)
