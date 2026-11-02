// Прайс с галочками: человек сам собирает работу, видит сумму «от» и отправляет список в мессенджер.
(() => {
  const boxes = [...document.querySelectorAll('.calc__row input')];
  const sum = document.querySelector('[data-total]');
  const count = document.querySelector('[data-count]');
  const tg = document.querySelector('[data-send="tg"]');
  const wa = document.querySelector('[data-send="wa"]');
  if (!boxes.length || !sum) return;
  const money = (n) => n.toLocaleString('ru-RU').replace(/ |,/g, ' ') + ' ₽';

  const update = () => {
    const picked = boxes.filter((b) => b.checked);
    const total = picked.reduce((s, b) => s + Number(b.value || 0), 0);
    sum.textContent = picked.length ? 'от ' + money(total) : 'Отметьте услуги';
    count.textContent = picked.length ? `Выбрано: ${picked.length}. Точную сумму называем после осмотра.` : 'Точную сумму называем после осмотра.';
    const list = picked.map((b) => '— ' + b.dataset.name).join('\n');
    const text = picked.length ? `Здравствуйте! Хочу записаться:\n${list}\nОриентир по прайсу: от ${money(total)}.` : 'Здравствуйте! Хочу записаться на детейлинг.';
    const q = encodeURIComponent(text);
    tg.href = `https://t.me/gtn_detailing?text=${q}`;
    wa.href = `https://wa.me/79381156633?text=${q}`;
  };
  boxes.forEach((b) => b.addEventListener('change', update));
  update();
})();
