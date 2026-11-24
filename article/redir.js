var i=new URLSearchParams(location.search).get("id");location.replace(i&&/^[0-9]+$/.test(i)?"/blog/"+i:"/blog");
