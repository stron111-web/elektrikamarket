'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {categoryHref,menuRoots,type MenuCategory} from '../lib/navigation';
export function CategorySidebar({categories}:{categories:MenuCategory[]}) {
 const [open,setOpen]=useState(true);
 useEffect(()=>{setOpen(window.matchMedia('(min-width:821px)').matches);},[]);
 return <details className="home-catalog" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>Каталог товаров</summary><nav aria-label="Разделы каталога">{menuRoots(categories).map(c=><Link prefetch={false} key={c.id} href={categoryHref(c.slug)} title={c.name}><span className="category-label">{c.name}</span><span aria-hidden="true">›</span></Link>)}</nav></details>;
}
