
function fit() {
  var s = Math.min(1, document.documentElement.clientWidth / 794);
  document.querySelectorAll('.sheet').forEach(function (el) {
    el.style.width = (794 * s) + 'px';
    el.style.height = (1123 * s) + 'px';
    el.firstElementChild.style.transform = s < 1 ? 'scale(' + s + ')' : '';
  });
}
window.addEventListener('resize', fit);
fit();

var b=document.getElementById('imprimer'); if(b) b.addEventListener('click', function(){ window.print(); });
