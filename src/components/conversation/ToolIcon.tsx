import {
  ArrowRight,
  Bot,
  Eye,
  FileEdit,
  FilePen,
  Files,
  FileText,
  FolderSearch,
  Info,
  List,
  ListChecks,
  MessageCircle,
  Play,
  RefreshCw,
  Search,
  Terminal,
  Wrench,
} from 'lucide-solid'

export const ICON_PROPS = { size: 13, strokeWidth: 2 } as const

export type ToolIconProps = {
  name: string
}

export function ToolIcon(props: ToolIconProps) {
  switch (props.name) {
    case 'bash':
    case 'sh':
    case 'computer_bash':
    case 'run_command':
      return <Terminal {...ICON_PROPS} />
    case 'read':
      return <Eye {...ICON_PROPS} />
    case 'write':
      return <FileEdit {...ICON_PROPS} />
    case 'edit':
      return <FilePen {...ICON_PROPS} />
    case 'multiedit':
      return <Files {...ICON_PROPS} />
    case 'grep':
      return <Search {...ICON_PROPS} />
    case 'find':
      return <FolderSearch {...ICON_PROPS} />
    case 'update_plan':
      return <ListChecks {...ICON_PROPS} />
    case 'ls':
      return <List {...ICON_PROPS} />
    case 'Agent':
    case 'get_subagent_result':
    case 'steer_subagent':
      return <Bot {...ICON_PROPS} />
    case 'TaskCreate':
    case 'TaskList':
    case 'TaskGet':
    case 'TaskUpdate':
    case 'TaskExecute':
    case 'TaskOutput':
    case 'TaskStop':
      return <ListChecks {...ICON_PROPS} />
    case 'spec_create':
      return <FileText {...ICON_PROPS} />
    case 'spec_next_phase':
      return <ArrowRight {...ICON_PROPS} />
    case 'spec_run_task':
      return <Play {...ICON_PROPS} />
    case 'spec_run_all':
      return <ListChecks {...ICON_PROPS} />
    case 'spec_status':
      return <Info {...ICON_PROPS} />
    case 'spec_analyze':
      return <Search {...ICON_PROPS} />
    case 'spec_sync_tasks':
      return <RefreshCw {...ICON_PROPS} />
    case 'ask_user_question':
      return <MessageCircle {...ICON_PROPS} />
    default:
      return <Wrench {...ICON_PROPS} />
  }
}
