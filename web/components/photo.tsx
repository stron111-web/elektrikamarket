'use client';
import { useState } from 'react';
export function Photo({ src, alt, className = '' }: { src: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} /> : <div className={`photo-placeholder ${className}`}><span>▧</span><small>Фото пока нет</small></div>;
}
export function Gallery({ images, name }: { images: { url: string; alt: string | null }[]; name: string }) {
  const [active, setActive] = useState(0);
  return <div className="gallery" aria-label="Фотографии товара"><Photo key={images[active]?.url ?? 'empty'} src={images[active]?.url ?? null} alt={images[active]?.alt ?? name} className="main-photo" />{images.length>0 && <p className="gallery-caption" aria-live="polite">Фото {active+1} из {images.length} · <a href={images[active].url} target="_blank" rel="noopener noreferrer">Открыть оригинал ↗</a></p>}<div className="thumbnails">{images.map((image, i) => <button type="button" key={image.url} className={i === active ? 'selected' : ''} onClick={() => setActive(i)} aria-label={`Фотография ${i+1}`} aria-pressed={i === active}><Photo src={image.url} alt={image.alt ?? `${name}, фото ${i+1}`} /></button>)}</div></div>;
}
