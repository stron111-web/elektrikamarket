'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function PaymentWatcher() {
  const router = useRouter();
  useEffect(() => {
    const go = (orderId: string) => {
      if (/^\d+$/.test(orderId)) router.push(`/order/done?order=${orderId}`);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; orderId?: string };
      if (data?.type === 'em-paid' && data.orderId) go(data.orderId);
    };
    const channel = new BroadcastChannel('em-pay');
    channel.onmessage = (event: MessageEvent<{ type?: string; orderId?: string }>) => {
      if (event.data?.type === 'em-paid' && event.data.orderId) go(event.data.orderId);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      channel.close();
    };
  }, [router]);
  return null;
}
