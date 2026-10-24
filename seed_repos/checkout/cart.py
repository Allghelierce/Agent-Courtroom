class Cart:
    """A shopping cart keyed by SKU."""

    def __init__(self):
        self.items = {}  # sku -> (unit_price, quantity)

    def add_item(self, sku, unit_price, quantity=1):
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        self.items[sku] = (unit_price, quantity)

    def remove_item(self, sku, quantity=1):
        unit_price, current = self.items[sku]
        self.items[sku] = (unit_price, current - quantity)

    def subtotal(self):
        return round(sum(price for price, quantity in self.items.values()), 2)

    def item_count(self):
        return sum(quantity for _, quantity in self.items.values())
