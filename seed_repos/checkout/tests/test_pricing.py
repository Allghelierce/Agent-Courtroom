import unittest

import pricing


class TestPricing(unittest.TestCase):
    def test_discount_is_a_percentage(self):
        self.assertEqual(pricing.apply_discount(200, 10), 180)

    def test_tax(self):
        self.assertEqual(pricing.tax(100), 8.25)

    def test_total_without_discount(self):
        self.assertEqual(pricing.total(100), 108.25)

    def test_total_taxes_the_discounted_amount(self):
        self.assertEqual(pricing.total(100, 20), 86.6)
