import type { PlacedComponent } from './types';
import { COMPONENT_DEFS } from './types';
import {
  getScaleGroupMembers,
  getScalePrimaryId,
  isScalePrimary,
} from './scale-instances';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const INSTANCE_GAP = 10;
const GROUP_FRAME_PADDING = 22;
const SEPARATION_MARGIN = 18;
const LAYOUT_PASSES = 14;

export function getComponentRect(component: PlacedComponent): Rect {
  return {
    x: component.x,
    y: component.y,
    width: component.width,
    height: component.height,
  };
}

export function getScaleGroupBounds(
  members: PlacedComponent[],
  padding = GROUP_FRAME_PADDING
): Rect {
  if (members.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const member of members) {
    minX = Math.min(minX, member.x);
    minY = Math.min(minY, member.y);
    maxX = Math.max(maxX, member.x + member.width);
    maxY = Math.max(maxY, member.y + member.height);
  }

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return !(
    a.x + a.width + margin <= b.x ||
    b.x + b.width + margin <= a.x ||
    a.y + a.height + margin <= b.y ||
    b.y + b.height + margin <= a.y
  );
}

function separationVector(mobile: Rect, obstacle: Rect, margin: number): { dx: number; dy: number } {
  const overlapLeft = mobile.x + mobile.width + margin - obstacle.x;
  const overlapRight = obstacle.x + obstacle.width + margin - mobile.x;
  const overlapTop = mobile.y + mobile.height + margin - obstacle.y;
  const overlapBottom = obstacle.y + obstacle.height + margin - mobile.y;

  const overlapX = Math.min(overlapLeft, overlapRight);
  const overlapY = Math.min(overlapTop, overlapBottom);

  if (overlapX <= 0 || overlapY <= 0) {
    return { dx: 0, dy: 0 };
  }

  const mobileCx = mobile.x + mobile.width / 2;
  const mobileCy = mobile.y + mobile.height / 2;
  const obstacleCx = obstacle.x + obstacle.width / 2;
  const obstacleCy = obstacle.y + obstacle.height / 2;

  if (overlapX < overlapY) {
    return { dx: mobileCx >= obstacleCx ? overlapX : -overlapX, dy: 0 };
  }
  return { dx: 0, dy: mobileCy >= obstacleCy ? overlapY : -overlapY };
}

function ensureGroupAnchor(primary: PlacedComponent): { x: number; y: number } {
  if (primary.scaleAnchorX === undefined || primary.scaleAnchorY === undefined) {
    primary.scaleAnchorX = primary.x;
    primary.scaleAnchorY = primary.y;
  }
  return { x: primary.scaleAnchorX, y: primary.scaleAnchorY };
}

export function layoutScaleGroupMembers(members: PlacedComponent[]): void {
  if (members.length <= 1) return;

  const primary =
    members.find((member) => isScalePrimary(member)) ?? members[0];
  const anchor = ensureGroupAnchor(primary);
  const def = COMPONENT_DEFS[primary.type];
  const cellW = def.width;
  const cellH = def.height;

  const sorted = [...members].sort((a, b) => {
    if (a.id === primary.id) return -1;
    if (b.id === primary.id) return 1;
    return a.id.localeCompare(b.id);
  });

  const cols = sorted.length <= 2 ? sorted.length : sorted.length <= 4 ? 2 : 3;

  for (let index = 0; index < sorted.length; index++) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    sorted[index].x = anchor.x + col * (cellW + INSTANCE_GAP);
    sorted[index].y = anchor.y + row * (cellH + INSTANCE_GAP);
  }
}

function translateMembers(members: PlacedComponent[], dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  for (const member of members) {
    member.x += dx;
    member.y += dy;
  }
  const primary = members.find((member) => isScalePrimary(member));
  if (primary && primary.scaleAnchorX !== undefined && primary.scaleAnchorY !== undefined) {
    primary.scaleAnchorX += dx;
    primary.scaleAnchorY += dy;
  }
}

function memberGroupId(component: PlacedComponent): string | null {
  if (!component.scaleGroupId && !isScalePrimary(component)) return null;
  return getScalePrimaryId(component);
}

export function applyBoardLayout(components: PlacedComponent[]): void {
  const primaries = components.filter(isScalePrimary);

  for (const primary of primaries) {
    layoutScaleGroupMembers(getScaleGroupMembers(components, primary.id));
  }

  for (let pass = 0; pass < LAYOUT_PASSES; pass++) {
    let moved = false;

    const groups = primaries
      .map((primary) => {
        const members = getScaleGroupMembers(components, primary.id);
        return {
          primary,
          members,
          memberIds: new Set(members.map((member) => member.id)),
          bounds: getScaleGroupBounds(members),
        };
      })
      .filter((group) => group.members.length > 1)
      .sort(
        (a, b) =>
          b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height
      );

    for (const group of groups) {
      for (const component of components) {
        if (group.memberIds.has(component.id)) continue;

        const compRect = getComponentRect(component);
        const { dx, dy } = separationVector(compRect, group.bounds, SEPARATION_MARGIN);
        if (dx === 0 && dy === 0) continue;

        component.x += dx;
        component.y += dy;
        moved = true;
      }
    }

    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i];
        const b = groups[j];
        if (!rectsOverlap(a.bounds, b.bounds, SEPARATION_MARGIN)) continue;

        const { dx, dy } = separationVector(b.bounds, a.bounds, SEPARATION_MARGIN);
        if (dx === 0 && dy === 0) continue;

        translateMembers(b.members, dx, dy);
        b.bounds = getScaleGroupBounds(b.members);
        moved = true;
      }
    }

    if (!moved) break;
  }
}

export interface ScaleGroupFrame {
  primaryId: string;
  label: string;
  emoji: string;
  instanceCount: number;
  bounds: Rect;
}

export function collectScaleGroupFrames(components: PlacedComponent[]): ScaleGroupFrame[] {
  const frames: ScaleGroupFrame[] = [];

  for (const component of components) {
    if (!isScalePrimary(component)) continue;
    const members = getScaleGroupMembers(components, component.id);
    if (members.length <= 1) continue;

    const def = COMPONENT_DEFS[component.type];
    frames.push({
      primaryId: component.id,
      label: def.label,
      emoji: def.emoji,
      instanceCount: members.length,
      bounds: getScaleGroupBounds(members),
    });
  }

  return frames;
}

export function componentBelongsToScaleGroup(
  component: PlacedComponent,
  primaryId: string
): boolean {
  return memberGroupId(component) === primaryId;
}
