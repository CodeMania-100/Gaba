from pricing_core import normalize_inventory_rows


HEADER = ["מס' קומה", "מספר דירה", "מס' חדרים", 'שטח דירה (מ"ר)', "שטח מרפסת", "כיווני אוויר", "הערות"]


def test_unknown_orientation_stays_unknown_for_standard_unit():
    rows = [HEADER, [2, 9, 3, 69, 12, None, None]]
    result = normalize_inventory_rows(rows)
    assert result[0].unit.orientation is None
    assert result[0].unit.unit_type == "standard_apartment"


def test_supplied_total_is_used_for_triplex_and_component_balconies_are_summed():
    rows = [
        HEADER,
        [9, 36, 6, 73.4, 12, "מזרח", "טריפלקס"],
        [10, 36, 6, 78.5, 20, "מזרח", "טריפלקס"],
        [11, 36, 6, 103.3, 62.6, "מזרח", "טריפלקס"],
        ['סה"כ', 36, 6, 255.2, None, "מזרח", "טריפלקס"],
    ]
    record = normalize_inventory_rows(rows)[0]
    assert record.unit.internal_area == 255.2
    assert record.unit.balcony_area == 94.6
    assert record.unit.floor == "9-11"
    assert "used_supplied_total_internal_area" in record.derivation_reasons


def test_missing_duplex_total_is_derived_and_labelled_not_silently_assumed():
    rows = [
        HEADER,
        [9, 39, 5, 74.8, 19.6, None, "דופלקס"],
        [10, 39, 5, 83.8, 20, None, "דופלקס"],
    ]
    record = normalize_inventory_rows(rows)[0]
    assert record.unit.internal_area == 158.6
    assert record.unit.orientation is None
    assert "derived_internal_area_sum_from_component_rows" in record.derivation_reasons
