import consumer from "../channels/consumer";

var subscriptions = {};
var pendingRequests = {};
var lastProcessedResponse = {};

function scrollMax($element) {
  $element.scrollTop($element[0].scrollHeight - $element.outerHeight());
}

function stripXray(string) {
  if (string) {
    return string.replace(/<!--XRAY [A-Z]+ \d+[^>]*-->/g, '');
  }
}

// this is a place where you can strip out any funky debug html that might be different from request to request.
function htmlIsEqual(first, second) {
  return stripXray(first) == stripXray(second);
}

function refreshModelBase(modelName, modelId) {
  var selector = '[data-model="' + modelName + '"][data-id="' + modelId + '"]';

  $(selector).each(function(_, element) {
    console.log('Refreshing model base for ' + modelName + ":" + modelId);

    var $existingModelBase = $(element);

    // we support restoring the scroll position of overflowed divs that are being redrawn.
    // we also support restoring a scroll position that was at the bottom of the scroll area.
    var $scrollBase = $existingModelBase.closest(".modal.chat-style-scrolling");
    if (!$scrollBase.length) {
      $scrollBase = $existingModelBase.closest(".chat-style-scrolling");
    }
    if ($scrollBase.length > 0) {
      var existingScroll = $scrollBase.scrollTop();
      var existingMaxScrollTop = $scrollBase[0].scrollHeight - $scrollBase.outerHeight();
      var scrollMaxed = existingScroll > (existingMaxScrollTop - 20);
    }

    // if we're in a modal with a current url, use that to redraw the model.
    var modalUrl = $existingModelBase.closest('.modal[data-url]').attr('data-url');

    // if our content was presented inline, use the url we were fetched from to redraw the model.
    var inlineUrl = $existingModelBase.closest('.inline[data-url]').attr('data-url');

    var url = modalUrl || inlineUrl || document.location.href;

    function applyUpdatedView(data) {
      var $modelBase = $(data).find(selector).addBack(selector);

      // TODO we should implement _something_ like this... but it has to work. probably needs an html linter.
      if (htmlIsEqual($modelBase.html(), $existingModelBase.html())) {
        return;
      }

      var $elementsWithPersistentClasses = $existingModelBase.find('[data-persistent-classes]');

      $existingModelBase.empty();
      $existingModelBase.append($modelBase.children());

      $existingModelBase.find('[data-persistent-classes]').each(function(_, element) {
        var $element = $(element);
        var subselector = '[data-persistent-classes][data-model="' + $element.attr('data-model') + '"][data-id="' + $element.attr('data-id') + '"]';
        var $oldElement = $elementsWithPersistentClasses.find(subselector).addBack(subselector);
        $oldElement.attr('data-persistent-classes').split(' ').forEach(function(className) {
          if ($oldElement.hasClass(className)) {
            $element.addClass(className);
          }
        })
      });

      if ($scrollBase.length > 0) {
        if (scrollMaxed) {
          scrollMax($scrollBase);
        } else {
          $scrollBase.scrollTop(existingScroll);
        }
      }

      // allow developers to be notified when the contents of a model have been updated.
      // if js was applied to these elements, they'll need to reapply it.
      console.log("triggering sprinkles:model:repopulated");
      $existingModelBase.trigger('sprinkles:model:repopulated');
      $existingModelBase.trigger('sprinkles:update');
    };

    // if there is already a pending request to this url ..
    if (pendingRequests[url]) {

      // don't trigger another request, just register ourselves to also be a recipient of that payload.
      pendingRequests[url].push(applyUpdatedView);

    } else {

      // otherwise, register ourselves as the first to be a recipient of the payload.
      pendingRequests[url] = [applyUpdatedView];

      function fetchContent(urlRequesterCount) {

        // keep track when when we're dispatching this request.
        var requestDispatchedAt = Date();

        // and when the response comes in ..
        $.get(url, {layoutless: true}, function(data) {

          // don't even bother processing this request if it was requested before a request we've already processed.
          if (lastProcessedResponse[url] && lastProcessedResponse[url] > requestDispatchedAt) {
            return;
          } else {
            lastProcessedResponse[url] = requestDispatchedAt;
          }

          console.log("By the time the results got back, we had " + pendingRequests[url].length + " folks waiting in total, vs. " + urlRequesterCount + " when we began.");

          var processedRequests = pendingRequests[url];

          // only bother applying these updates if no additional folks have requested from the same url.
          // if others have requested from the same url, we need to fetch a newer version anyway.
          // TODO we can improve this by tracking local updates to individual sections of the page.
          if (processedRequests.length <= urlRequesterCount) {
            delete pendingRequests[url];
            $.each(processedRequests, function(_, scopedApplyUpdatedView) {
              console.log("applying update view #" + _);
              scopedApplyUpdatedView(data);
            });
          } else {

            // actually, we can actually still apply these updates to the view as long as the view author hasn't
            // specifically warned us not to. they may want to withhold these updates from being presented to the
            // user on views that are heavy in multiple-step client-side manipulation, like dragging and dropping
            // on the kanban board.
            if ($existingModelBase.attr('data-suppress-outdated-view-updates') === undefined) {
              $.each(processedRequests, function(_, scopedApplyUpdatedView) {
                console.log("temporarily applying update view #" + _);
                scopedApplyUpdatedView(data);
              });
            }

            // if there were follow-alongs that jumped onboard to wait for this request, we actually need to send one more
            // request to the server just to make sure no results changed after the first request was made, as subsequent
            // changes that wouldn't be represented in that payload might have been waht caused the additional requests
            // to the same url. this is still the best approach because we can discard it if the results are the same (e.g.
            // not do a redraw of the elements) and in the case of multiple follow-alongs, we're consolidating those
            // requests to _one_ extra, instead of many extra.

            // and when the response comes in ..
            console.log("there was more than one request requirement addressed");
            fetchContent(pendingRequests[url].length);
          }

        });

      }

      setTimeout(function() {
        fetchContent(pendingRequests[url].length);
      }, 100);

    }
  });
}

function subscribeToModels() {
  var renewedSubscriptions = {};
  $("[data-model]").each(function(_, element) {
    var $element = $(element);
    var $model = $element;
    var modelName = $model.attr('data-model');
    var modelId = $model.attr('data-id');

    var key = modelName + ":" + modelId;

    console.log("🍩 Models: Subscribing for updates from " + key);

    if (subscriptions[key]) {
      renewedSubscriptions[key] = subscriptions[key];

    } else {
      var timer;
      renewedSubscriptions[key] = consumer.subscriptions.create({
        channel: 'Sprinkles::ModelsChannel',
        model_name: modelName,
        model_id: modelId
      }, {
        received(data) {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }

          timer = setTimeout(function() {
            console.log("received " + modelName + "_" + modelId);
            refreshModelBase(modelName, modelId);
          }, 100);

        },
      });

    }
  });

  $.each(subscriptions, function(key, subscription) {
    if (!renewedSubscriptions[key]) {
      consumer.subscriptions.remove(subscription);
    }
  });

  subscriptions = renewedSubscriptions;
}

$(document).on('turbo:load', function() {
  subscribeToModels();
})

$(document).on('sprinkles:update', function(event) {
  console.log("🍩 models received sprinkles:update");
  subscribeToModels();
})

// TODO keep track of connections and each time the page changes, see whether you need to unsubscribe from any.
// TODO only broadcast _after_ all the transaction has committed to the database.
// TODO save a list of all the channels to broadcast to and then broadcast to them once at the end of the entire transaction.
