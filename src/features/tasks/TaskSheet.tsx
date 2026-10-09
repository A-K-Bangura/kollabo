import { Sheet } from '@/components/ui/Dialog'
import { TaskDetail } from './TaskDetail'
import { TaskForm } from './TaskForm'
import { useTaskSheet } from './useTaskSheet'

/** The single place a task is created or inspected, driven by the URL (see useTaskSheet). */
export function TaskSheet() {
  const { taskId, isNew, defaultDueDate, close } = useTaskSheet()

  return (
    <Sheet open={isNew || taskId !== null} onClose={close} title={isNew ? 'New task' : 'Task'}>
      {isNew ? (
        <TaskForm defaultDueDate={defaultDueDate} onDone={close} onCancel={close} />
      ) : taskId ? (
        <TaskDetail taskId={taskId} onClose={close} />
      ) : null}
    </Sheet>
  )
}
