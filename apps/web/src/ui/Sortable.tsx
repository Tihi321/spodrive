import type { ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

/** Vertical sortable list; items identified by string ids (their order = `ids`). Touch friendly via drag handles. */
export function SortableList({ ids, onMove, children }: { ids: string[]; onMove(from: number, to: number): void; children: ReactNode }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    if (from >= 0 && to >= 0) onMove(from, to);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function SortableItem({ id, children }: { id: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button
      type="button"
      aria-label="Drag to reorder"
      title="Drag to reorder"
      className="shrink-0 cursor-grab touch-none rounded p-1.5 text-white/40 hover:text-white active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripVertical size={18} />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 5 : undefined, position: "relative" }}
      className={isDragging ? "rounded-lg bg-surface2 shadow-xl" : undefined}
    >
      {children(handle)}
    </div>
  );
}
