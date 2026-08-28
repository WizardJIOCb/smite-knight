export type ItemId =
  | 'healing-potion'
  | 'iron-blade'
  | 'oak-shield'
  | 'marching-boots'
  | 'blood-vial'
  | 'moon-charm'
  | 'warbrand'
  | 'bastion-plate'
  | 'windrunner'
  | 'vampire-crown'
  | 'phoenix-heart';

export type ItemTier = 'consumable' | 'common' | 'unique';
export type BountyRole = 'soldier' | 'archer' | 'brute' | 'boss' | 'player';

export interface PlayerItemStats {
  attackDamage: number;
  maxHealth: number;
  moveSpeed: number;
  damageReduction: number;
  lifesteal: number;
  healthRegen: number;
}

export interface ShopItem {
  id: ItemId;
  name: string;
  icon: string;
  tier: ItemTier;
  description: string;
  cost: number;
  stats?: Partial<PlayerItemStats>;
  recipe?: readonly ItemId[];
  heal?: number;
  maxStack?: number;
}

export interface InventorySlot {
  itemId: ItemId;
  quantity: number;
}

export interface EconomyState {
  gold: number;
  passiveRemainder: number;
  inventory: readonly InventorySlot[];
}

export interface EconomyActionResult {
  ok: boolean;
  state: EconomyState;
  message: string;
  healed?: number;
}

export const STARTING_GOLD = 600;
export const GOLD_PER_SECOND = 3;
export const INVENTORY_CAPACITY = 6;
export const HEALING_POTION_ID: ItemId = 'healing-potion';

const EMPTY_STATS: PlayerItemStats = {
  attackDamage: 0,
  maxHealth: 0,
  moveSpeed: 0,
  damageReduction: 0,
  lifesteal: 0,
  healthRegen: 0,
};

export const SHOP_ITEMS: readonly ShopItem[] = [
  { id: 'healing-potion', name: 'Багряное зелье', icon: '🧪', tier: 'consumable', description: 'Мгновенно восстанавливает 90 здоровья. Складывается по 3.', cost: 90, heal: 90, maxStack: 3 },
  { id: 'iron-blade', name: 'Железный клинок', icon: '🗡️', tier: 'common', description: '+7 к урону.', cost: 350, stats: { attackDamage: 7 } },
  { id: 'oak-shield', name: 'Дубовый щит', icon: '🛡️', tier: 'common', description: '+50 здоровья и 6% защиты.', cost: 320, stats: { maxHealth: 50, damageReduction: 0.06 } },
  { id: 'marching-boots', name: 'Походные сапоги', icon: '🥾', tier: 'common', description: '+0,45 к скорости движения.', cost: 300, stats: { moveSpeed: 0.45 } },
  { id: 'blood-vial', name: 'Сосуд крови', icon: '🩸', tier: 'common', description: '4% вампиризма от нанесённого урона.', cost: 400, stats: { lifesteal: 0.04 } },
  { id: 'moon-charm', name: 'Лунный оберег', icon: '🌙', tier: 'common', description: '+1,8 здоровья в секунду.', cost: 450, stats: { healthRegen: 1.8 } },
  { id: 'warbrand', name: 'Клеймо войны', icon: '⚔️', tier: 'unique', description: '+28 к урону. Собирается из двух клинков.', cost: 650, stats: { attackDamage: 28 }, recipe: ['iron-blade', 'iron-blade'] },
  { id: 'bastion-plate', name: 'Латы бастиона', icon: '🦾', tier: 'unique', description: '+180 здоровья и 20% защиты.', cost: 650, stats: { maxHealth: 180, damageReduction: 0.2 }, recipe: ['oak-shield', 'oak-shield'] },
  { id: 'windrunner', name: 'Поступь бури', icon: '🌪️', tier: 'unique', description: '+12 к урону и +1 к скорости.', cost: 600, stats: { attackDamage: 12, moveSpeed: 1 }, recipe: ['marching-boots', 'iron-blade'] },
  { id: 'vampire-crown', name: 'Кровавая корона', icon: '👑', tier: 'unique', description: '+15 к урону, 14% вампиризма и регенерация.', cost: 800, stats: { attackDamage: 15, lifesteal: 0.14, healthRegen: 1.5 }, recipe: ['blood-vial', 'iron-blade', 'moon-charm'] },
  { id: 'phoenix-heart', name: 'Сердце феникса', icon: '🔥', tier: 'unique', description: '+220 здоровья, 8% защиты и мощная регенерация.', cost: 850, stats: { maxHealth: 220, damageReduction: 0.08, healthRegen: 4 }, recipe: ['oak-shield', 'moon-charm'] },
] as const;

const ITEM_BY_ID = Object.fromEntries(SHOP_ITEMS.map((item) => [item.id, item])) as Record<ItemId, ShopItem>;

export function getShopItem(id: ItemId): ShopItem {
  return ITEM_BY_ID[id];
}

export function createEconomyState(): EconomyState {
  return { gold: STARTING_GOLD, passiveRemainder: 0, inventory: [] };
}

export function advanceEconomy(state: EconomyState, seconds: number): EconomyState {
  const total = state.passiveRemainder + Math.max(0, seconds) * GOLD_PER_SECOND;
  const earned = Math.floor(total);
  return {
    ...state,
    gold: state.gold + earned,
    passiveRemainder: total - earned,
  };
}

export function grantGold(state: EconomyState, amount: number): EconomyState {
  return { ...state, gold: state.gold + Math.max(0, Math.floor(amount)) };
}

export function killBounty(role: BountyRole): number {
  if (role === 'boss') return 600;
  if (role === 'brute') return 110;
  if (role === 'archer') return 70;
  if (role === 'soldier') return 55;
  return 0;
}

export function totalItemCost(item: ShopItem): number {
  return item.cost + (item.recipe ?? []).reduce((sum, id) => sum + getShopItem(id).cost, 0);
}

export function inventoryItemCount(inventory: readonly InventorySlot[], itemId: ItemId): number {
  return inventory.reduce((total, slot) => total + (slot.itemId === itemId ? slot.quantity : 0), 0);
}

export function getInventoryStats(inventory: readonly InventorySlot[]): PlayerItemStats {
  const stats = { ...EMPTY_STATS };
  for (const slot of inventory) {
    const item = getShopItem(slot.itemId);
    if (!item.stats) continue;
    for (const key of Object.keys(EMPTY_STATS) as (keyof PlayerItemStats)[]) {
      stats[key] += (item.stats[key] ?? 0) * slot.quantity;
    }
  }
  stats.damageReduction = Math.min(0.65, stats.damageReduction);
  stats.lifesteal = Math.min(0.5, stats.lifesteal);
  return stats;
}

function removeOne(inventory: readonly InventorySlot[], itemId: ItemId): InventorySlot[] | undefined {
  const index = inventory.findIndex((slot) => slot.itemId === itemId);
  if (index < 0) return undefined;
  const next = inventory.map((slot) => ({ ...slot }));
  if (next[index].quantity > 1) next[index].quantity -= 1;
  else next.splice(index, 1);
  return next;
}

function addOne(inventory: readonly InventorySlot[], item: ShopItem): InventorySlot[] | undefined {
  const next = inventory.map((slot) => ({ ...slot }));
  const stackIndex = item.maxStack
    ? next.findIndex((slot) => slot.itemId === item.id && slot.quantity < item.maxStack!)
    : -1;
  if (stackIndex >= 0) {
    next[stackIndex].quantity += 1;
    return next;
  }
  if (next.length >= INVENTORY_CAPACITY) return undefined;
  next.push({ itemId: item.id, quantity: 1 });
  return next;
}

export function purchaseItem(state: EconomyState, itemId: ItemId): EconomyActionResult {
  const item = getShopItem(itemId);
  if (item.tier === 'unique' && inventoryItemCount(state.inventory, itemId) > 0) {
    return { ok: false, state, message: 'Этот уникальный предмет уже собран.' };
  }
  if (state.gold < item.cost) {
    return { ok: false, state, message: `Не хватает ${item.cost - state.gold} золота.` };
  }

  let inventory = state.inventory.map((slot) => ({ ...slot }));
  for (const componentId of item.recipe ?? []) {
    const next = removeOne(inventory, componentId);
    if (!next) {
      return { ok: false, state, message: `Нужен компонент: ${getShopItem(componentId).name}.` };
    }
    inventory = next;
  }

  const withItem = addOne(inventory, item);
  if (!withItem) return { ok: false, state, message: `Инвентарь заполнен: доступно ${INVENTORY_CAPACITY} слотов.` };
  return {
    ok: true,
    state: { ...state, gold: state.gold - item.cost, inventory: withItem },
    message: item.recipe ? `Собрано: ${item.name}.` : `Куплено: ${item.name}.`,
  };
}

export function consumeHealingPotion(state: EconomyState, missingHealth: number): EconomyActionResult {
  if (missingHealth <= 0) return { ok: false, state, message: 'Здоровье уже полное.' };
  const nextInventory = removeOne(state.inventory, HEALING_POTION_ID);
  if (!nextInventory) return { ok: false, state, message: 'В инвентаре нет лечебного зелья.' };
  const healed = Math.min(getShopItem(HEALING_POTION_ID).heal ?? 0, missingHealth);
  return {
    ok: true,
    state: { ...state, inventory: nextInventory },
    message: `Зелье восстановило ${Math.ceil(healed)} здоровья.`,
    healed,
  };
}
