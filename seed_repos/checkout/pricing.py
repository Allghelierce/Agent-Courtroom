TAX_RATE = 0.0825


def apply_discount(amount, percent):
    """Take `percent` percent off `amount`."""
    return amount - percent


def tax(amount):
    return round(amount * TAX_RATE, 2)


def total(subtotal, discount_percent=0):
    """Discount first, then tax the discounted amount."""
    discounted = apply_discount(subtotal, discount_percent)
    return round(discounted + tax(subtotal), 2)
