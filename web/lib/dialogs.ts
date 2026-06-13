export type DialogTone = 'info' | 'warn' | 'danger' | 'success';

export interface DialogButtonSpec {
  label: string;
  value: string;
  tone?: 'primary' | 'secondary' | 'danger';
  autoFocus?: boolean;
}

export interface DialogSpec {
  id: number;
  title?: string;
  message: string;
  tone: DialogTone;
  buttons: DialogButtonSpec[];
  input?: { label?: string; placeholder?: string; defaultValue?: string; multiline?: boolean };
  resolve: (result: { button: string; value?: string }) => void;
}

type Listener = (queue: DialogSpec[]) => void;
const listeners = new Set<Listener>();
let queue: DialogSpec[] = [];
let nextId = 1;

function emit() {
  for (const l of listeners) l(queue);
}

export function subscribeDialogs(l: Listener): () => void {
  listeners.add(l);
  l(queue);
  return () => { listeners.delete(l); };
}

function push(spec: Omit<DialogSpec, 'id' | 'resolve'>): Promise<{ button: string; value?: string }> {
  return new Promise(resolve => {
    const dlg: DialogSpec = { ...spec, id: nextId++, resolve };
    queue = [...queue, dlg];
    emit();
  });
}

export function resolveDialog(id: number, result: { button: string; value?: string }): void {
  const dlg = queue.find(d => d.id === id);
  if (!dlg) return;
  queue = queue.filter(d => d.id !== id);
  dlg.resolve(result);
  emit();
}

export interface AlertOptions {
  title?: string;
  message: string;
  tone?: DialogTone;
  okLabel?: string;
}

export async function alertDialog(opts: AlertOptions | string): Promise<void> {
  const o = typeof opts === 'string' ? { message: opts } : opts;
  await push({
    title: o.title,
    message: o.message,
    tone: o.tone ?? 'info',
    buttons: [{ label: o.okLabel ?? 'OK', value: 'ok', tone: 'primary', autoFocus: true }],
  });
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  tone?: DialogTone;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export async function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  const o = typeof opts === 'string' ? { message: opts } : opts;
  const result = await push({
    title: o.title,
    message: o.message,
    tone: o.tone ?? (o.destructive ? 'danger' : 'info'),
    buttons: [
      { label: o.cancelLabel ?? 'Cancel', value: 'cancel', tone: 'secondary' },
      { label: o.confirmLabel ?? (o.destructive ? 'Delete' : 'OK'), value: 'ok', tone: o.destructive ? 'danger' : 'primary', autoFocus: true },
    ],
  });
  return result.button === 'ok';
}

export interface PromptOptions {
  title?: string;
  message: string;
  tone?: DialogTone;
  placeholder?: string;
  defaultValue?: string;
  inputLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  multiline?: boolean;
}

export async function promptDialog(opts: PromptOptions | string): Promise<string | null> {
  const o = typeof opts === 'string' ? { message: opts } : opts;
  const result = await push({
    title: o.title,
    message: o.message,
    tone: o.tone ?? 'info',
    buttons: [
      { label: o.cancelLabel ?? 'Cancel', value: 'cancel', tone: 'secondary' },
      { label: o.confirmLabel ?? 'OK', value: 'ok', tone: 'primary', autoFocus: true },
    ],
    input: { label: o.inputLabel, placeholder: o.placeholder, defaultValue: o.defaultValue, multiline: o.multiline },
  });
  return result.button === 'ok' ? (result.value ?? '') : null;
}
