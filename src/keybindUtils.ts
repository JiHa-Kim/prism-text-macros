export const normalizeKeyCombo = (e: KeyboardEvent): string => {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && e.key !== 'Shift') parts.push('Shift');
  if (e.metaKey) parts.push('Meta');

  // Normalize key names
  let key = e.key;
  if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') {
    return parts.join('+'); // Just modifiers
  }

  if (key === ' ') key = 'Space';

  parts.push(key);
  return parts.join('+');
};

export const formatActionName = (action: string): string => {
  return action.split('_').map(word => word.charAt(0) + word.slice(1).toLowerCase()).join(' ');
};