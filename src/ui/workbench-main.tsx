/**
 * Entry point for the Policy Workbench (Albert's controlled experiment).
 *
 * Separate from main.tsx on purpose: policy-workbench.css carries global element styles for a
 * dark console, so it must never load alongside the light product shell.
 */

import ReactDOM from 'react-dom/client'
import { PolicyWorkbench } from './screens/PolicyWorkbench.tsx'
import './policy-workbench.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<PolicyWorkbench />)
