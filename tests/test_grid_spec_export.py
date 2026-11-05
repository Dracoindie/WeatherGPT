from maps import export_grid_spec as gen


def test_generated_grid_spec_is_current():
    assert gen.OUTPUT.read_text(encoding="utf-8") == gen.render(), (
        "weathergpt-web/components/map3d/gridSpec.generated.ts is stale; run "
        "backend/.venv/Scripts/python backend/maps/export_grid_spec.py"
    )


def test_samples_cover_both_verdicts():
    verdicts = {s["fits"] for s in gen.samples()}
    assert verdicts == {True, False}
