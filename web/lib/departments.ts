export type Department = {
  id: string;
  name: string;
  query: string;
  photo?: string;
};

/** Разделы левого меню старого магазина, без «хитов», «новинок» и «скидок». */
export const departments: Department[] = [
  { id: 'climate', name: 'Климатические и инженерные системы', query: 'обогреватель', photo: '/brand/sections/climate.png?v=7' },
  { id: 'trunking', name: 'Кабеленесущие системы', query: 'кабель-канал', photo: '/brand/sections/trunking.png?v=7' },
  { id: 'hv', name: 'Высоковольтное и щитовое оборудование', query: 'щит', photo: '/brand/sections/hv.png?v=7' },
  { id: 'cable', name: 'Кабели, провода и аксессуары', query: 'кабель', photo: '/brand/sections/cable.png?v=7' },
  { id: 'wiring', name: 'Изделия для электромонтажа', query: 'клемма', photo: '/brand/sections/wiring.png?v=7' },
  { id: 'light', name: 'Освещение', query: 'светильник', photo: '/brand/sections/light.png?v=7' },
  { id: 'lv', name: 'Низковольтное и промышленное электрооборудование', query: 'автоматический выключатель', photo: '/brand/sections/lv.png?v=7' },
  { id: 'install', name: 'Электроустановочные изделия', query: 'розетка', photo: '/brand/sections/install.png?v=7' },
  { id: 'power', name: 'Генераторы электроэнергии и элементы питания', query: 'генератор', photo: '/brand/sections/power.png?v=7' },
  { id: 'tools', name: 'Инструменты, техника', query: 'инструмент', photo: '/brand/sections/tools.png?v=7' },
  { id: 'telecom', name: 'Связь, телекоммуникации', query: 'витая пара', photo: '/brand/sections/telecom.png?v=7' },
  { id: 'unlinked', name: 'Позиции без привязки к категории', query: '', photo: '/brand/sections/unlinked.png?v=7' },
  { id: 'safety', name: 'Устройства и средства безопасности', query: 'извещатель', photo: '/brand/sections/safety.png?v=7' },
  { id: 'other', name: 'Прочие товары', query: '', photo: '/brand/sections/other.png?v=7' },
];

export function departmentHref(department: Department) {
  if (!department.query) return '/catalog';
  return `/catalog?q=${encodeURIComponent(department.query)}`;
}
