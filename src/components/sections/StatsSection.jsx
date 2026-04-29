import { useTranslation } from 'react-i18next';
import { FiClock, FiDollarSign, FiUsers } from 'react-icons/fi';

export function StatsSection() {
	const { t } = useTranslation();
	const localizedItems = t('stats.items', { returnObjects: true, defaultValue: [] });
	const items =
		Array.isArray(localizedItems) && localizedItems.length
			? localizedItems
			: [
					{ value: '3012', label: 'users in the project' },
					{ value: '$545K', label: 'invested in the project' },
					{ value: '2 years', label: 'project operating time' },
				];
	const icons = [FiUsers, FiDollarSign, FiClock];

	return (
		<section className="stats_section layout_padding-bottom">
			<div className="container">
				<div className="heading_container heading_center">
					<h2>{t('stats.title')}</h2>
				</div>
				<div className="stats_grid">
					{items.map((item, index) => {
						const Icon = icons[index] || FiUsers;
						return (
							<div className="stats_card" key={`${item.value}-${index}`}>
								<Icon className="stats_card_icon" aria-hidden="true" />
								<strong>{item.value}</strong>
								<span>{item.label}</span>
							</div>
						);
					})}
				</div>
			</div>
		</section>
	);
}
