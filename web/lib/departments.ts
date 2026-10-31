export type Department = {
  id: string;
  name: string;
  query: string;
};

/** Разделы левого меню старого магазина, без «хитов», «новинок» и «скидок». */
export const departments: Department[] = [
  { id: 'climate', name: 'Климатические и инженерные системы', query: 'обогреватель' },
  { id: 'trunking', name: 'Кабеленесущие системы', query: 'кабель-канал' },
  { id: 'hv', name: 'Высоковольтное и щитовое оборудование', query: 'щит' },
  { id: 'cable', name: 'Кабели, провода и аксессуары', query: 'кабель' },
  { id: 'wiring', name: 'Изделия для электромонтажа', query: 'клемма' },
  { id: 'light', name: 'Освещение', query: 'светильник' },
  { id: 'lv', name: 'Низковольтное и промышленное электрооборудование', query: 'автоматический выключатель' },
  { id: 'install', name: 'Электроустановочные изделия', query: 'розетка' },
  { id: 'power', name: 'Генераторы электроэнергии и элементы питания', query: 'генератор' },
  { id: 'tools', name: 'Инструменты, техника', query: 'инструмент' },
  { id: 'telecom', name: 'Связь, телекоммуникации', query: 'витая пара' },
  { id: 'unlinked', name: 'Позиции без привязки к категории', query: '' },
  { id: 'other', name: 'Прочие товары', query: '' },
  { id: 'safety', name: 'Устройства и средства безопасности', query: 'извещатель' },
];

export function departmentHref(department: Department) {
  if (!department.query) return '/catalog';
  return `/catalog?q=${encodeURIComponent(department.query)}`;
}
